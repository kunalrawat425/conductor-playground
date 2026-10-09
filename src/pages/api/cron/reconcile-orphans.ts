import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { notifyOrderParties } from "../../../lib/server/notify-order-parties";
import { settleCapturedPayment, PAYABLE_STATUSES, refundOrderRazorpay } from "../../../lib/server/razorpay-ledger";
import { refundRazorpayPayment } from "../../../lib/server/razorpay-refund";

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

  // Refunds owed but never completed (Razorpay rejected them, or the network
  // failed): a pre-order priced lower (refund_amt on a live order) or a paid
  // order that was cancelled/declined. Nothing retried these before — the buyer
  // waited on a "seller must refund manually" note. Razorpay is asked first how
  // much is already refunded, so a retry can never refund twice.
  let refundRetried = 0, refundStillFailing = 0;
  const { data: owed } = await sb
    .from("orders")
    .select("id, status, razorpay_payment_id, razorpay_order_id, refund_amt, refund_note")
    .eq("payment_method", "razorpay")
    .not("razorpay_payment_id", "is", null)
    .is("refund_sent_at", null)
    .gt("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
    .or("refund_amt.gt.0,status.in.(cancelled,declined)")
    .limit(50);
  for (const o of (owed || []) as any[]) {
    const closed = ["cancelled", "declined"].includes(o.status);
    let outcome;
    if (closed) {
      outcome = await refundOrderRazorpay(sb, o, { caller: "cron:refund-retry" });
    } else {
      const dueBack = Math.round(Number(o.refund_amt) * 100);
      let already = 0;
      try {
        const pr = await fetch(`https://api.razorpay.com/v1/payments/${o.razorpay_payment_id}`, { headers: { Authorization: `Basic ${rzpAuth}` } });
        if (pr.ok) already = Number((await pr.json())?.amount_refunded) || 0;
      } catch { /* treat as nothing refunded yet */ }
      outcome = already >= dueBack
        ? { ok: true, refundId: null, note: "already refunded on Razorpay" }
        : await refundRazorpayPayment(o.razorpay_payment_id, { order_id: o.id, caller: "cron:refund-retry" }, dueBack - already);
    }
    const patch: Record<string, unknown> = { refund_note: `${o.refund_note ? o.refund_note + " | " : ""}Retry: ${outcome.note}`.slice(0, 1000) };
    if (outcome.ok) patch.refund_sent_at = new Date().toISOString();
    await sb.from("orders").update(patch).eq("id", o.id).is("refund_sent_at", null);
    outcome.ok ? refundRetried++ : refundStillFailing++;
  }

  console.log(`[cron/reconcile-orphans] scanned=${orphans?.length ?? 0} flipped=${flipped} refunded=${refunded} skipped=${skipped} errors=${errors} refund_retried=${refundRetried} refund_failing=${refundStillFailing}`);
  return new Response(JSON.stringify({ ok: true, scanned: orphans?.length ?? 0, flipped, refunded, skipped, errors, refund_retried: refundRetried, refund_failing: refundStillFailing }), { status: 200 });
}

export const GET: APIRoute = async ({ request, url }) => run(request, url.origin);
export const POST: APIRoute = async ({ request, url }) => run(request, url.origin);
