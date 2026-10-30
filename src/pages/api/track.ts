import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

/** Funnel steps the site may log (supabase/migrations/087_funnel_events.sql). */
const EVENTS = new Set(["landing", "shop_view", "seller_view", "login_shown", "otp_sent", "otp_resend", "otp_failed", "otp_verified", "add_to_cart", "checkout_started"]);
const UUID = /^[0-9a-f-]{36}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : null);

/**
 * POST /api/track — one funnel step from the browser (sendBeacon, text/plain JSON). Analytics only:
 * never blocks the buyer, always answers 204. No phone numbers are stored here.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const text = await request.text();
    if (text.length > 4000) return new Response(null, { status: 204 });
    const b = JSON.parse(text || "{}");
    if (!EVENTS.has(b.event)) return new Response(null, { status: 204 });
    const meta = b.meta && typeof b.meta === "object" && JSON.stringify(b.meta).length <= 1000 ? b.meta : null;
    const sb = createClient(import.meta.env.PUBLIC_SUPABASE_URL || "", import.meta.env.SUPABASE_SERVICE_KEY || "");
    await sb.from("funnel_events").insert({
      event: b.event,
      visitor_id: str(b.visitor_id, 64),
      buyer_id: UUID.test(String(b.buyer_id || "")) ? b.buyer_id : null,
      seller_id: UUID.test(String(b.seller_id || "")) ? b.seller_id : null,
      path: str(b.path, 200),
      source: str(b.source, 120),
      internal: b.internal === true,
      meta,
    });
  } catch (err: any) {
    console.warn("[track] dropped", err?.message);
  }
  return new Response(null, { status: 204 });
};
