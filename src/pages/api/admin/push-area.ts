import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { haversineKm } from "../../../lib/order-pricing";
import { sendCustomBuyerPush } from "../../../lib/server/buyer-push";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const ADMIN_SECRET = import.meta.env.ADMIN_SECRET || "";
const PROMO_GAP_HOURS = 20;

/**
 * POST /api/admin/push-area   (Authorization: Bearer $ADMIN_SECRET)
 * Body: { lat, lng, radius_km?=10, title, body, url?="/shop", dry_run?=true }
 *
 * Push to every buyer with notifications on whose location — the map pick saved
 * by AppShell, else their default address — is within radius_km of (lat, lng).
 * e.g. Thane: { "lat": 19.2183, "lng": 72.9781, "radius_km": 10 }.
 * Dry run by default: returns the count only. Skips buyers who got a promo in
 * the last 20h and test accounts. Never returns phone numbers.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!ADMIN_SECRET) return new Response(JSON.stringify({ error: "ADMIN_SECRET not configured" }), { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${ADMIN_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let b: any;
  try { b = await request.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }
  const lat = Number(b.lat), lng = Number(b.lng);
  const radius = Math.min(50, Math.max(0.5, Number(b.radius_km) || 10));
  const title = String(b.title || "").trim().slice(0, 80);
  const body = String(b.body || "").trim().slice(0, 200);
  const url = typeof b.url === "string" && b.url.startsWith("/") ? b.url : "/shop";
  const dryRun = b.dry_run !== false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !title || !body) {
    return new Response(JSON.stringify({ error: "lat, lng, title and body are required" }), { status: 400 });
  }

  const sb = createClient(supabaseUrl, supabaseServiceKey);
  const { data: buyers, error } = await sb
    .from("buyers")
    .select("id, lat, lng, is_test, last_promo_push_sent_at, buyer_addresses(lat, lng, is_default)")
    .eq("push_enabled", true)
    .not("push_subscription", "is", null);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const cutoff = Date.now() - PROMO_GAP_HOURS * 3600_000;
  let noLocation = 0, recentlyPushed = 0, sent = 0, failed = 0;
  const targets: string[] = [];
  for (const x of buyers || []) {
    if ((x as any).is_test) continue;
    const addr = ((x as any).buyer_addresses || []).find((a: any) => a.is_default) || ((x as any).buyer_addresses || [])[0];
    const bl = x.lat ?? addr?.lat, bg = x.lng ?? addr?.lng;
    if (bl == null || bg == null) { noLocation++; continue; }
    if (haversineKm(lat, lng, Number(bl), Number(bg)) > radius) continue;
    if (x.last_promo_push_sent_at && new Date(x.last_promo_push_sent_at).getTime() > cutoff) { recentlyPushed++; continue; }
    targets.push(x.id);
  }

  if (!dryRun) {
    for (const id of targets) {
      const r = await sendCustomBuyerPush(id, { title, body }, url);
      if (r.ok && (r as any).sent) {
        sent++;
        await sb.from("buyers").update({ last_promo_push_sent_at: new Date().toISOString() }).eq("id", id);
      } else failed++;
    }
  }

  return new Response(JSON.stringify({
    dry_run: dryRun, radius_km: radius, push_enabled_buyers: (buyers || []).length,
    in_area: targets.length, skipped_no_location: noLocation, skipped_recent_promo: recentlyPushed, sent, failed,
  }), { status: 200 });
};
