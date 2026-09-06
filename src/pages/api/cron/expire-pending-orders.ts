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
 * Rows with `razorpay_order_id` set are LEFT ALONE — they may still capture
 * via the webhook (razorpay-webhook.ts) or manual reconcile.
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

  const rows = data ?? [];
  const n = rows.length;

  // BUG-33: this cron cancelled orders without ever returning their stock,
  // unlike /api/orders/cancel which restores it. Any `pending` row that had
  // already deducted inventory leaked that stock permanently — the listing
  // stayed short and the seller could not sell it again.
  let restored = 0;
  for (const row of rows) {
    if (!(row as any).listing_id || (row as any).inventory_deducted !== true) continue;
    const { error: rErr } = await sb.rpc("restore_order_stock", {
      p_listing_id: (row as any).listing_id,
      p_quantity: (row as any).quantity,
    });
    if (rErr) console.warn("[cron/expire-pending] stock restore failed", { order_id: (row as any).id, err: rErr.message });
    else restored++;
  }

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

  console.log(`[cron/expire-pending] expired ${n} orders older than 24h (stock restored: ${restored}, notified: ${notified})`);
  return new Response(JSON.stringify({ ok: true, expired: n, stock_restored: restored, notified }), { status: 200 });
}

export const GET: APIRoute = async ({ request, url }) => run(request, url.origin);
export const POST: APIRoute = async ({ request, url }) => run(request, url.origin);
