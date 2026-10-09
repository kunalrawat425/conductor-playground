import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const CRON_SECRET = import.meta.env.CRON_SECRET || "";

/**
 * Nightly cron: auto-cancel `pending_payment` orders older than 24h
 * that never got a Razorpay order created (buyer walked away pre-payment).
 *
 * Rows with `razorpay_order_id` get 48h, then Razorpay is asked: captured
 * payments are settled, otherwise the order expires too.
 *
 * Vercel cron schedule (add to vercel.json):
 *   { "path": "/api/cron/expire-pending-orders", "schedule": "0 3 * * *" }
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
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("orders")
    .update({ status: "cancelled", cancel_reason: "auto_expired_payment", cancelled_by: "system" })
    .in("status", ["pending", "pending_payment"])
    .is("razorpay_order_id", null)
    .lt("created_at", cutoff)
    .select("id, listing_id, quantity, inventory_deducted");

  if (error) {
    console.error("[cron/expire-pending] failed", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const rows = [...(data ?? [])];

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
      .not("razorpay_order_id", "is", null)
      .lt("created_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
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
  let notified = 0;
  const { notifyOrderParties } = await import("../../../lib/server/notify-order-parties");
  for (const row of rows) {
    await notifyOrderParties({ order_id: (row as any).id, event: "expired_unpaid", origin })
      .then(() => { notified++; })
      .catch((err: any) => console.warn("[cron/expire-pending] notify failed", { order_id: (row as any).id, err: err?.message }));
  }

  console.log(`[cron/expire-pending] expired ${n} orders older than 24h (notified: ${notified})`);
  return new Response(JSON.stringify({ ok: true, expired: n, notified }), { status: 200 });
}

export const GET: APIRoute = async ({ request, url }) => run(request, url.origin);
export const POST: APIRoute = async ({ request, url }) => run(request, url.origin);
