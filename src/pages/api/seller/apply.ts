import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { requireSeller } from "../../../lib/server/session";
import { overLimit } from "../../../lib/server/rate-limit";
import { sendTransactionalEmail } from "../../../lib/server/send-email";
import { escapeHtml } from "../../../lib/html";
import { SUPPORT_EMAIL } from "../../../lib/brand";
import { cleanSellerApplication } from "../../../lib/seller-application";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * POST /api/seller/apply
 * Body: { seller_id, fish_sold, source_market, fssai }
 * Emails a new seller's application to us. The shop details are read from the row
 * (saved just before through /api/seller/profile); the extra answers have no column.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => null);
    const seller_id = body?.seller_id;
    const denied = requireSeller(request, seller_id);
    if (denied) return denied;
    // A seller re-submitting a few times is fine; a loop filling our inbox is not.
    if (overLimit(`seller-apply:${seller_id}`, 5, 60 * 60 * 1000)) {
      return json({ error: "Too many requests. Please try again shortly." }, 429);
    }

    const app = cleanSellerApplication(body);
    if ("error" in app) return json({ error: app.error }, 400);

    const { data: s, error } = await createClient(supabaseUrl, supabaseServiceKey)
      .from("sellers")
      .select("name, first_name, last_name, phone, email, location_name, lat, lng, has_pickup, has_delivery, delivery_rad, is_active")
      .eq("id", seller_id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!s) return json({ error: "Seller not found" }, 404);

    const fulfil = [s.has_pickup !== false && "Pickup", s.has_delivery && `Delivery (${s.delivery_rad || 5} km)`].filter(Boolean).join(" + ");
    const rows: [string, unknown][] = [
      ["Shop", s.name],
      ["Owner", [s.first_name, s.last_name].filter(Boolean).join(" ")],
      ["Phone", s.phone],
      ["Email", s.email],
      ["Area", s.location_name],
      ["GPS", s.lat != null && s.lng != null ? `${s.lat}, ${s.lng}` : ""],
      ["Fulfilment", fulfil],
      ["Fish sold", app.fish_sold],
      ["Buys from", app.source_market],
      ["FSSAI", app.fssai],
      ["Seller id", seller_id],
      ["Active", s.is_active ? "yes" : "no (approve in admin)"],
    ];
    const html = `
      <h2>New seller application</h2>
      <table style="border-collapse:collapse;font-family:sans-serif;">
        ${rows.map(([k, v]) => `<tr><td style="padding:8px;font-weight:bold;">${k}</td><td style="padding:8px;">${escapeHtml(v || "—")}</td></tr>`).join("")}
      </table>
    `;
    const sent = await sendTransactionalEmail(SUPPORT_EMAIL, `New seller application: ${s.name} — ${s.phone}`, html, "seller-apply");
    // "skipped" = no Resend key (local / preview): the shop details are still saved on the row.
    if (sent.startsWith("failed")) return json({ error: "Couldn't send your details. Please try again." }, 502);
    return json({ success: true }, 200);
  } catch (err: any) {
    console.error("Seller apply error:", err);
    return json({ error: err.message }, 500);
  }
};
