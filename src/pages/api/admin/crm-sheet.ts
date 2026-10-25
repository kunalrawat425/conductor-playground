import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { crmRow, type CrmBuyer } from "../../../lib/crm-sheet";

export const prerender = false;

const KEY = import.meta.env.CRM_SHEET_KEY || process.env.CRM_SHEET_KEY || "";
// Never in the sheet: the founder and the shared test accounts.
const EXCLUDE = ["9870619974", "9999900001"];
const last10 = (p: string | null | undefined) => String(p ?? "").replace(/\D/g, "").slice(-10);

/**
 * GET /api/admin/crm-sheet: real buyers as rows for the founder's Google Sheet (read-only).
 * Auth: header `x-crm-key: $CRM_SHEET_KEY` (its own key, not ADMIN_SECRET). 404 when unset or wrong.
 */
export const GET: APIRoute = async ({ request }) => {
  const given = request.headers.get("x-crm-key") || "";
  if (!KEY || given.length !== KEY.length || !timingSafeEqual(Buffer.from(given), Buffer.from(KEY))) return new Response("Not found", { status: 404 });

  const sb = createClient(import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL!, import.meta.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY!);
  const [{ data: buyers }, { data: sellers }] = await Promise.all([
    sb.from("buyers").select("id, phone, first_name, last_name, email, location_name, created_at, whatsapp_opt_in_at, whatsapp_opt_out_at, push_enabled, is_test").order("created_at"),
    sb.from("sellers").select("phone"),
  ]);
  const sellerPhones = new Set((sellers || []).map((s: any) => last10(s.phone)).filter(Boolean));
  const real = (buyers || []).filter((b: any) => !b.is_test && last10(b.phone).length === 10 && !EXCLUDE.includes(last10(b.phone)) && !last10(b.phone).endsWith("8190") && !sellerPhones.has(last10(b.phone)));
  const ids = real.map((b: any) => b.id);
  const [{ data: carts }, { data: orders }, { data: addrs }] = await Promise.all([
    sb.from("buyer_cart").select("buyer_id, updated_at, listing:fish_listings(description, species, seller:sellers(name))").in("buyer_id", ids),
    sb.from("orders").select("id, buyer_id, species, status, razorpay_payment_id, payment_verified_at, total_price, delivery_fee, created_at, utm_source, utm_campaign, is_test, listing:fish_listings(seller:sellers(name))").in("buyer_id", ids).eq("is_test", false).order("created_at"),
    sb.from("buyer_addresses").select("buyer_id, building, location_name").in("buyer_id", ids),
  ]);
  const by = <T,>(rows: T[] | null, f: (r: T) => string) => (rows || []).reduce((m, r) => (m.get(f(r))?.push(r) ?? m.set(f(r), [r]), m), new Map<string, T[]>());
  const cartsBy = by(carts as any[], (r: any) => r.buyer_id), ordersBy = by(orders as any[], (r: any) => r.buyer_id), addrBy = by(addrs as any[], (r: any) => r.buyer_id);

  const rows = real.map((b: any) => {
    const c = cartsBy.get(b.id) || [];
    const buyer: CrmBuyer = {
      phone: last10(b.phone), name: `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim(), email: b.email || "", area: b.location_name || "",
      created_at: b.created_at, whatsapp_opt_in: !!b.whatsapp_opt_in_at, whatsapp_opt_out: !!b.whatsapp_opt_out_at, push: !!b.push_enabled,
      society: [...new Set((addrBy.get(b.id) || []).map((a: any) => [a.building, a.location_name].filter(Boolean).join(", ")).filter(Boolean))],
      cart: c.map((r: any) => `${String(r.listing?.description || r.listing?.species || "").split(" · ")[0]} (${r.listing?.seller?.name ?? "?"})`),
      cart_updated: c.map((r: any) => r.updated_at).sort().pop() ?? null,
      orders: (ordersBy.get(b.id) || []).map((o: any) => ({
        id: String(o.id).slice(0, 8).toUpperCase(), species: o.species, status: o.status, paid: !!(o.razorpay_payment_id || o.payment_verified_at),
        amount: Math.round(Number(o.total_price || 0) + Number(o.delivery_fee || 0)), created_at: o.created_at, seller: o.listing?.seller?.name ?? null,
        source: [o.utm_source, o.utm_campaign].filter(Boolean).join(" / "),
      })),
    };
    return crmRow(buyer);
  });
  return new Response(JSON.stringify({ updated_at: new Date().toISOString(), rows }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
};
