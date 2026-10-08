import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { notifyOrderParties } from "../../../lib/server/notify-order-parties";
import { settleCapturedPayment, PAYABLE_STATUSES } from "../../../lib/server/razorpay-ledger";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const RAZORPAY_KEY_ID = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = import.meta.env.RAZORPAY_KEY_SECRET || "";
const CRON_SECRET = import.meta.env.CRON_SECRET || "";

/**
 * Daily cron (vercel.json: 17 4 * * * — Hobby plan allows daily only): auto-reconcile
 * Razorpay payments the client handler and the webhook both missed.
 *   - Events lost due to webhook downtime or an unset RAZORPAY_WEBHOOK_SECRET
 *   - Rows created before the webhook was live
 *   - Payments that landed after the order was cancelled/declined (refunded by settle)
 *
 * Scans orders WHERE razorpay_order_id IS NOT NULL AND status IN (payable, cancelled,
 * declined), created 5 minutes to 14 days ago (grace period so we don't race the webhook).
 *
 * Auth: Authorization: Bearer $CRON_SECRET.
 */
async function run(request: Request, origin: string) {
  if (!CRON_SECRET) return new Response(JSON.stringify({ error: "CRON_SECRET not configured" }), { status: 503 });
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${CRON_SECRET}`) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const sb = createClient(supabaseUrl, supabaseServiceKey);
  const rzpAuth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  const graceCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data: orphans, error } = await sb
    .from("orders")
    .select("id, razorpay_order_id")
    .not("razorpay_order_id", "is", null)
    // Payable rows whose handler + webhook both missed, plus recently closed
    // rows: a payment that landed after cancel/decline is captured money the
    // buyer must get back (settle refunds it).
    .in("status", [...PAYABLE_STATUSES, "cancelled", "declined"])
    .lt("created_at", graceCutoff)
    .gt("created_at", new Date(Date.now() - 14 * 86400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[cron/reconcile-orphans] scan failed", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let flipped = 0, refunded = 0, skipped = 0, errors = 0;
  for (const o of (orphans || [])) {
    const rzpOrder = (o as any).razorpay_order_id;
    let res: Response;
    try {
      res = await fetch(`https://api.razorpay.com/v1/orders/${rzpOrder}/payments`, {
        headers: { Authorization: `Basic ${rzpAuth}` },
      });
    } catch { errors++; continue; }
    if (!res.ok) { errors++; continue; }
    const rzpData = await res.json();
    const captured = Array.isArray(rzpData.items) ? rzpData.items.filter((p: any) => p?.status === "captured") : [];
    if (!captured.length) { skipped++; continue; }
    // Every captured payment, not just the first: two tabs can capture two.
    for (const pmt of captured) {
      try {
        const r = await settleCapturedPayment(sb, { razorpay_order_id: rzpOrder, razorpay_payment_id: pmt.id, source: "cron" });
        if (r.kind === "confirmed") {
          flipped++;
          console.log(`[cron/reconcile-orphans] recovered ${(o as any).id} via payment ${pmt.id}`);
          // The buyer paid, the client handler dropped and the webhook missed it —
          // this is the last chance anyone gets told.
          await notifyOrderParties({ order_id: (o as any).id, event: "payment_confirmed", origin })
            .catch((err: any) => console.warn("[cron/reconcile-orphans] notify failed", { order_id: (o as any).id, err: err?.message }));
        } else if (r.kind === "refunded") {
          refunded++;
        }
      } catch (err: any) {
        console.error("[cron/reconcile-orphans] settle failed", { order_id: (o as any).id, payment: pmt.id, err: err?.message });
        errors++;
      }
    }
  }

  console.log(`[cron/reconcile-orphans] scanned=${orphans?.length ?? 0} flipped=${flipped} refunded=${refunded} skipped=${skipped} errors=${errors}`);
  return new Response(JSON.stringify({ ok: true, scanned: orphans?.length ?? 0, flipped, refunded, skipped, errors }), { status: 200 });
}

export const GET: APIRoute = async ({ request, url }) => run(request, url.origin);
export const POST: APIRoute = async ({ request, url }) => run(request, url.origin);
