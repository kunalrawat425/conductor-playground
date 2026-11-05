import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { UNPAID_EXPIRY_MS } from "../../../lib/pay-on-delivery";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const CRON_SECRET = import.meta.env.CRON_SECRET || "";

/**
 * Auto-cancel unpaid orders after UNPAID_EXPIRY_MS (founder, 6 Nov 2026: 2 hours, was 24h/48h).
 * Rows with a `razorpay_order_id` ask Razorpay first: captured payments are settled,
 * a payment still in flight waits, otherwise the order expires too.
 *
 * Pay-on-delivery orders aren't unpaid in that sense: they wait for the seller, and only
 * expire when the seller never confirmed by the end of the delivery slot.
 *
 * Runs every 10 minutes from pg_cron (migration 094); the daily Vercel cron stays as a fallback.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` (Vercel Cron injects this).
 */
async function run(request: Request, origin: string) {
  if (!CRON_SECRET) {
    return new Response(JSON.stringify({ error: "CRON_SECRET not configured" }), { status: 503 });
  }
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const sb = createClient(supabaseUrl, supabaseServiceKey);
  const cutoff = new Date(Date.now() - UNPAID_EXPIRY_MS).toISOString();

  const { data, error } = await sb
    .from("orders")
    .update({ status: "cancelled", cancel_reason: "auto_expired_payment", cancelled_by: "system" })
    .in("status", ["pending", "pending_payment"])
    .eq("pay_on_delivery", false)
    .is("razorpay_order_id", null)
    .lt("created_at", cutoff)
    .select("id, listing_id, quantity, inventory_deducted");

  if (error) {
    console.error("[cron/expire-pending] failed", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const rows = [...(data ?? [])];

  // Pay on delivery the seller never confirmed: give up once the delivery slot is over
  // (no slot: a day after ordering). Nothing was paid, so nothing to refund.
  const now = new Date().toISOString();
  const { data: podStale } = await sb
    .from("orders")
    .select("id, status, delivery_slot_end, created_at")
    .in("status", ["pending", "pending_payment"])
    .eq("pay_on_delivery", true)
    .is("razorpay_payment_id", null)
    .limit(200);
  for (const o of podStale ?? []) {
    const end = (o as any).delivery_slot_end || new Date(new Date((o as any).created_at).getTime() + 24 * 3600_000).toISOString();
    if (end > now) continue;
    const { data: gone } = await sb
      .from("orders")
      .update({ status: "cancelled", cancel_reason: "seller_no_response", cancelled_by: "system" })
      .eq("id", (o as any).id)
      .eq("status", (o as any).status)
      .is("razorpay_payment_id", null)
      .select("id, listing_id, quantity, inventory_deducted");
    if (gone?.[0]) rows.push(gone[0]);
  }

  // Rows WITH a razorpay_order_id were left alone forever: an abandoned
  // checkout stayed `pending_payment` indefinitely (3 on prod). After 48h, ask
  // Razorpay. Captured money is settled (confirm or refund) by the shared rules;
  // nothing captured and nothing in flight → expire like any unpaid order.
  const keyId = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
  const keySecret = import.meta.env.RAZORPAY_KEY_SECRET || "";
  if (keyId && keySecret) {
    const { settleCapturedPayment } = await import("../../../lib/server/razorpay-ledger");
    const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
    const { data: stale } = await sb
      .from("orders")
      .select("id, status, razorpay_order_id")
      .in("status", ["pending", "pending_payment"])
      .eq("pay_on_delivery", false)
      .not("razorpay_order_id", "is", null)
      .lt("created_at", cutoff)
      .limit(100);
    for (const o of stale ?? []) {
      let items: any[];
      try {
        const res = await fetch(`https://api.razorpay.com/v1/orders/${(o as any).razorpay_order_id}/payments`, { headers: { Authorization: auth } });
        if (!res.ok) continue; // can't see Razorpay → never expire blind (BUG-41)
        items = (await res.json())?.items ?? [];
      } catch { continue; }
      const captured = items.filter((p) => p?.status === "captured");
      if (captured.length) {
        for (const p of captured) {
          await settleCapturedPayment(sb, { razorpay_order_id: (o as any).razorpay_order_id, razorpay_payment_id: p.id, source: "cron" })
            .catch((err: any) => console.error("[cron/expire-pending] settle failed", { order_id: (o as any).id, err: err?.message }));
        }
        continue;
      }
      if (items.some((p) => p?.status === "authorized")) continue; // still in flight
      const { data: expired } = await sb
        .from("orders")
        .update({ status: "cancelled", cancel_reason: "auto_expired_payment", cancelled_by: "system" })
        .eq("id", (o as any).id)
        .eq("status", (o as any).status)
        .select("id, listing_id, quantity, inventory_deducted");
      if (expired?.[0]) rows.push(expired[0]);
    }
  }

  const n = rows.length;

  // BUG-33 was WRONG and is reverted here. Stock is already returned by the
  // `trg_restore_inventory` AFTER UPDATE trigger (migration 029) whenever
  // status becomes cancelled/declined/refunded and inventory_deducted was
  // true. Adding an explicit restore_order_stock call here made it restore
  // twice. See BUG-38 for the trigger's own double-restore.
  // Do not reintroduce a restore call in this file.

  // BUG-31: the buyer's order was silently flipped to `cancelled` with no push
  // and no email — from their side the order simply vanished, which is exactly
  // the "my order disappeared" complaint. The seller was never told either, so
  // a held-back catch was never released.
  // One notification per cart, not per item (rows of one checkout share cart_id).
  let notified = 0;
  const { notifyOrderParties } = await import("../../../lib/server/notify-order-parties");
  const { data: cartOf } = rows.length
    ? await sb.from("orders").select("id, cart_id").in("id", rows.map((r: any) => r.id))
    : { data: [] as any[] };
  const groups = new Map<string, string[]>();
  for (const r of cartOf ?? []) {
    const key = (r as any).cart_id || (r as any).id;
    groups.set(key, [...(groups.get(key) ?? []), (r as any).id]);
  }
  for (const ids of groups.values()) {
    const row = { id: ids[0] };
    await notifyOrderParties({ order_id: (row as any).id, event: "expired_unpaid", origin, order_ids: ids })
      .then(() => { notified++; })
      .catch((err: any) => console.warn("[cron/expire-pending] notify failed", { order_id: (row as any).id, err: err?.message }));
  }

  console.log(`[cron/expire-pending] expired ${n} orders (notified: ${notified})`);
  return new Response(JSON.stringify({ ok: true, expired: n, notified }), { status: 200 });
}

export const GET: APIRoute = async ({ request, url }) => run(request, url.origin);
export const POST: APIRoute = async ({ request, url }) => run(request, url.origin);
