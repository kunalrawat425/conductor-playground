import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { sendCustomBuyerPush } from "../../../lib/server/buyer-push";
import { planSundayReminders, type ReminderBuyer, type ReminderSeller } from "../../../lib/server/sunday-reminder";

export const prerender = false;

/**
 * Saturday ~5 PM IST (vercel.json cron): push past buyers about Sunday fish from active sellers
 * that serve them (rules in lib/server/sunday-reminder.ts).
 * Auth: `Authorization: Bearer $CRON_SECRET` (Vercel cron sends it).
 * `?dry_run=1` returns the plan without sending; `?test_phone=<10 digits>` sends only to that buyer.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const secret = import.meta.env.CRON_SECRET || "";
  if (!secret) return new Response("CRON_SECRET not configured", { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const dryRun = url.searchParams.get("dry_run") === "1";
  const testPhone = (url.searchParams.get("test_phone") || "").replace(/\D/g, "").slice(-10);

  const sb = createClient(import.meta.env.PUBLIC_SUPABASE_URL || "", import.meta.env.SUPABASE_SERVICE_KEY || "");

  // Past buyers: a real order that was paid at some point (payment_type is set by a DB trigger).
  const { data: paid, error: pErr } = await sb
    .from("orders").select("buyer_id").eq("is_test", false).neq("payment_type", "unpaid").not("buyer_id", "is", null);
  if (pErr) return new Response(JSON.stringify({ error: pErr.message }), { status: 500 });
  const pastIds = [...new Set((paid || []).map((o: any) => o.buyer_id))];
  if (!pastIds.length) return Response.json({ ok: true, past_buyers: 0, planned: 0, sent: 0 });

  let bq = sb.from("buyers")
    .select("id, phone, lat, lng, is_test, last_promo_push_sent_at, buyer_addresses(lat, lng, is_default)")
    .in("id", pastIds).eq("push_enabled", true).not("push_subscription", "is", null);
  if (testPhone) bq = bq.eq("phone", testPhone);
  const [{ data: buyerRows, error: bErr }, { data: sellerRows, error: sErr }, { data: listingRows, error: lErr }] = await Promise.all([
    bq,
    sb.from("sellers").select("id, name, lat, lng, delivery_rad, opens_at, closes_at, open_days, accepts_preorder, preorder_days, preorder_cutoff_time").eq("is_active", true).or("is_test.is.null,is_test.eq.false"),
    sb.from("fish_listings").select("seller_id, is_available, is_preorder_enabled, is_order_paused"),
  ]);
  const err = bErr || sErr || lErr;
  if (err) return new Response(JSON.stringify({ error: err.message }), { status: 500 });

  const buyers: ReminderBuyer[] = (buyerRows || []).filter((b: any) => !b.is_test).map((b: any) => {
    const addr = (b.buyer_addresses || []).find((a: any) => a.is_default) || (b.buyer_addresses || [])[0];
    return { id: b.id, lat: b.lat ?? addr?.lat ?? null, lng: b.lng ?? addr?.lng ?? null, last_promo_push_sent_at: testPhone ? null : b.last_promo_push_sent_at };
  });
  const sellers: ReminderSeller[] = (sellerRows || []).map((s: any) => {
    const ls = (listingRows || []).filter((l: any) => l.seller_id === s.id);
    return { ...s, has_preorder_listing: ls.some((l: any) => l.is_preorder_enabled), has_sameday_listing: ls.some((l: any) => l.is_available && !l.is_order_paused) };
  });

  const plan = planSundayReminders(buyers, sellers, Date.now());
  let sent = 0;
  if (!dryRun) {
    for (const p of plan) {
      const r = await sendCustomBuyerPush(p.buyerId, { title: p.title, body: p.body }, p.path).catch(() => null);
      if ((r as any)?.sent) sent++;
    }
  }
  console.log(`[cron/sunday-reminder] past_buyers=${pastIds.length} reachable=${buyers.length} planned=${plan.length} sent=${sent} dry_run=${dryRun}`);
  return Response.json({
    ok: true, dry_run: dryRun, past_buyers: pastIds.length, reachable_with_push: buyers.length, planned: plan.length, sent,
    ...(dryRun ? { plan: plan.map(({ title, body, path, sellerIds }) => ({ title, body, path, sellers: sellerIds.length })) } : {}),
  });
};
