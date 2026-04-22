import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { priceUnitShortLabel } from "../../lib/listing-pricing";
import type { PriceUnit } from "../../lib/species";
import { loadWebPush } from "../../lib/server/load-web-push";
import { absoluteUrl } from "../../lib/server/site-origin";
import { normalizeVapidKeyForWebPush, trimVapidKey } from "../../lib/server/vapid-env";
import { fmtDateTimeFullIST } from "../../lib/format-ist";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

const vapidPublicKey = normalizeVapidKeyForWebPush(import.meta.env.PUBLIC_VAPID_KEY || "");
const vapidPrivateKey = normalizeVapidKeyForWebPush(import.meta.env.VAPID_PRIVATE_KEY || "");
const vapidContact = trimVapidKey(import.meta.env.VAPID_CONTACT || "") || "mailto:hello@zepto.in";

function normalizePushSubscription(raw: unknown): { endpoint: string; keys?: { p256dh: string; auth: string } } | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as { endpoint: string; keys?: { p256dh: string; auth: string } };
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && raw !== null && "endpoint" in raw) {
    return raw as { endpoint: string; keys?: { p256dh: string; auth: string } };
  }
  return null;
}

/**
 * POST /api/notify-seller
 * Body: { seller_id, species, quantity, quantity_unit, buyer_phone, order_id?, kind? }
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const kind = body.kind === "payment_proof" ? "payment_proof" : "new_order";
    const { seller_id, species, quantity, quantity_unit, buyer_phone, scheduled_for, order_id_short, order_id } = body;

    if (!seller_id) {
      return new Response(JSON.stringify({ error: "Missing seller_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: seller } = await supabase
      .from("sellers")
      .select("push_subscription, push_enabled, name")
      .eq("id", seller_id)
      .single();

    const subscription = normalizePushSubscription(seller?.push_subscription);
    if (!subscription?.endpoint) {
      return new Response(JSON.stringify({ skipped: true, reason: "no push subscription" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Heal flag when a subscription exists (mirrors buyer-push behavior).
    if (!seller?.push_enabled) {
      await supabase.from("sellers").update({ push_enabled: true }).eq("id", seller_id);
    }

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error("notify-seller: VAPID keys not configured");
      return new Response(JSON.stringify({ skipped: true, reason: "vapid not configured" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    let title: string;
    let pushBody: string;
    if (kind === "payment_proof") {
      const id = order_id_short ? String(order_id_short).toUpperCase() : "";
      title = "Payment proof received";
      pushBody = species
        ? `Buyer uploaded UPI proof for ${species}${id ? ` (order #${id})` : ""}. Verify in dashboard.`
        : `A buyer uploaded payment proof${id ? ` for order #${id}` : ""}. Verify in dashboard.`;
    } else {
      const u = String(quantity_unit || "piece");
      const unitLabel =
        u === "piece" || u === "kg"
          ? priceUnitShortLabel(u as PriceUnit)
          : u;
      const schedLabel = scheduled_for ? ` (Scheduled: ${fmtDateTimeFullIST(scheduled_for)})` : "";
      pushBody = species
        ? `New${scheduled_for ? " scheduled" : ""} order: ${species} ${quantity || ""}${unitLabel}${schedLabel}`
        : `You have a new${scheduled_for ? " scheduled" : ""} order${schedLabel}`;
      title = scheduled_for ? "New Scheduled Order! 🗓️" : "New Order!";
    }

    let dashboardUrl = absoluteUrl("/v2/dashboard/orders");
    if (typeof order_id === "string" && /^[0-9a-f-]{36}$/i.test(order_id.trim())) {
      dashboardUrl = absoluteUrl(`/v2/dashboard/orders?order=${encodeURIComponent(order_id.trim())}`);
    }

    try {
      const webPush = await loadWebPush();
      webPush.setVapidDetails(vapidContact, vapidPublicKey, vapidPrivateKey);
      await webPush.sendNotification(
        subscription,
        JSON.stringify({
          title,
          body: pushBody,
          url: dashboardUrl,
          tag: `seller-${kind}-${Date.now()}`,
        })
      );
    } catch (pushErr: any) {
      console.error("notify-seller push failed:", pushErr?.message || pushErr);
      return new Response(JSON.stringify({ skipped: true, reason: pushErr?.message || "push failed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Seller notify error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
