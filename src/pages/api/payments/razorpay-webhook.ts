import { createHmac, timingSafeEqual } from "node:crypto";
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const RAZORPAY_WEBHOOK_SECRET = import.meta.env.RAZORPAY_WEBHOOK_SECRET || "";

/**
 * Razorpay webhook. Server-of-record for payment reconciliation.
 * Fires even when the client-side `handler` in track/[id].astro drops.
 *
 * Configure at https://dashboard.razorpay.com → Settings → Webhooks:
 *   URL:    https://relifish.store/api/payments/razorpay-webhook
 *   Events: payment.captured, payment.failed, refund.created, refund.processed
 *   Secret: same value as env RAZORPAY_WEBHOOK_SECRET
 */
export const POST: APIRoute = async ({ request, url }) => {
  if (!RAZORPAY_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Webhook not configured" }), { status: 503 });
  }

  const raw = await request.text();
  const signatureHex = request.headers.get("x-razorpay-signature") || "";
  const expectedHex = createHmac("sha256", RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");

  let sigOk = false;
  try {
    const a = Buffer.from(signatureHex, "hex");
    const b = Buffer.from(expectedHex, "hex");
    sigOk = a.length === b.length && timingSafeEqual(a, b);
  } catch { /* malformed hex → sigOk stays false */ }
  if (!sigOk) {
    console.warn("[razorpay-webhook] invalid signature");
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const evtType = event?.event as string | undefined;
  const payment = event?.payload?.payment?.entity;

  if (!evtType) {
    return new Response(JSON.stringify({ error: "Malformed event" }), { status: 400 });
  }

  const sb = createClient(supabaseUrl, supabaseServiceKey);

  // ── payment.captured — flip pending → confirmed ─────────────────────
  if (evtType === "payment.captured") {
    if (!payment) {
      return new Response(JSON.stringify({ error: "Malformed payment event" }), { status: 400 });
    }
    const razorpay_order_id: string = payment.order_id;
    const razorpay_payment_id: string = payment.id;

    // Confirm, attach, or refund — the same rules verify and the crons use.
    const { settleCapturedPayment } = await import("../../../lib/server/razorpay-ledger");
    let settled;
    try {
      settled = await settleCapturedPayment(sb, { razorpay_order_id, razorpay_payment_id, source: "webhook" });
    } catch (err: any) {
      console.error("[razorpay-webhook] settle failed", { razorpay_order_id, razorpay_payment_id, err: err?.message });
      return new Response(JSON.stringify({ error: "Update failed" }), { status: 500 });
    }

    if (settled.kind === "orphan") {
      // No order carries this razorpay_order_id and its receipt matches nothing:
      // captured money with nothing to attach it to (BUG-41). Loudly.
      console.error(`[razorpay-webhook] ORPHANED PAYMENT: no order for razorpay_order_id ${razorpay_order_id} (payment ${razorpay_payment_id} captured). Manual reconcile required.`);
    } else {
      console.log(`[razorpay-webhook] captured ${razorpay_payment_id}: ${settled.kind} (order ${settled.order.id}, status ${settled.order.status})`);
    }

    // BUG-21: notify BOTH parties on BOTH channels. This is the recovery path
    // that fires when the buyer's browser died mid-payment, so the seller was
    // previously left blind on exactly the orders needing attention.
    if (settled.kind === "confirmed") {
      const { notifyOrderParties } = await import("../../../lib/server/notify-order-parties");
      await notifyOrderParties({
        order_id: settled.order.id,
        event: "payment_confirmed",
        origin: url.origin,
      }).catch((err: any) => console.warn("[razorpay-webhook] notify fan-out failed", { order_id: settled.order.id, err: err?.message }));
    }
    const n = settled.kind === "confirmed" ? 1 : 0;

    return new Response(JSON.stringify({ ok: true, event: "payment.captured", reconciled: n }), { status: 200 });
  }

  // ── refund.processed / refund.created — flip → refunded ─────────────
  if (evtType === "refund.processed" || evtType === "refund.created") {
    const refund = event?.payload?.refund?.entity;
    if (!refund) {
      return new Response(JSON.stringify({ error: "Malformed refund event" }), { status: 400 });
    }
    const razorpay_payment_id: string = refund.payment_id;
    const refund_id: string = refund.id;
    const refund_amt_paise = Number(refund.amount) || 0;

    const pay = event?.payload?.payment?.entity;
    const fullyRefunded = !pay || Number(pay.amount_refunded || 0) >= Number(pay.amount || 0);
    const now = new Date().toISOString();

    // First sighting of this refund? Our own cancel/decline/extra-payment paths
    // mark the ledger before Razorpay calls back, and refund.created is followed
    // by refund.processed — neither should notify twice.
    const { data: firstSeen } = await sb.from("razorpay_payments")
      .update({ refund_id, refunded_at: now })
      .eq("razorpay_payment_id", razorpay_payment_id)
      .is("refund_id", null)
      .select("order_id");

    const { data: order, error } = await sb.from("orders")
      .select("id, status, refund_sent_at")
      .eq("razorpay_payment_id", razorpay_payment_id)
      .maybeSingle();
    if (error) {
      console.error("[razorpay-webhook] refund lookup failed", { razorpay_payment_id, error: error.message });
      return new Response(JSON.stringify({ error: "Update failed" }), { status: 500 });
    }
    if (!order) {
      console.log(`[razorpay-webhook] ${evtType}: no order carries payment ${razorpay_payment_id} (extra/balance payment, legacy, or ledger-only)`);
      return new Response(JSON.stringify({ ok: true, event: evtType, reconciled: 0 }), { status: 200 });
    }

    // A refund never rewrites a closed order. It used to flip cancelled /
    // declined / completed rows to `refunded`, which the buyer page rendered as
    // "confirmed — being prepared", the seller dashboard offered Ready/Out
    // buttons on, and which restored stock on fish already handed over.
    // Only a FULL refund of a still-live order takes the order off.
    const flip = fullyRefunded && !["cancelled", "declined", "refunded", "completed", "picked_up"].includes(order.status);
    const firstSighting = (firstSeen?.length ?? 0) > 0 || !order.refund_sent_at;
    if (!flip && !firstSighting) {
      return new Response(JSON.stringify({ ok: true, event: evtType, reconciled: 0 }), { status: 200 });
    }
    const fields: Record<string, unknown> = flip ? { status: "refunded" } : {};
    if (firstSighting) {
      fields.refund_note = `Razorpay refund ${refund_id} (${evtType})`;
      fields.refund_amt = refund_amt_paise / 100;
      fields.refund_sent_at = now;
    }
    const { error: uErr } = await sb.from("orders").update(fields).eq("id", order.id).eq("status", order.status);
    if (uErr) {
      console.error("[razorpay-webhook] refund update failed", { razorpay_payment_id, error: uErr.message });
      return new Response(JSON.stringify({ error: "Update failed" }), { status: 500 });
    }

    // BUG-21: refunds also fan out to both parties on both channels.
    const { notifyOrderParties } = await import("../../../lib/server/notify-order-parties");
    await notifyOrderParties({
      order_id: order.id,
      event: "refunded",
      origin: url.origin,
      amount: refund_amt_paise / 100,
    }).catch((err: any) => console.warn("[razorpay-webhook] refund notify failed", { order_id: order.id, err: err?.message }));
    console.log(`[razorpay-webhook] ${evtType}: payment ${razorpay_payment_id} on order ${order.id} (${order.status}${flip ? " → refunded" : ""})`);
    return new Response(JSON.stringify({ ok: true, event: evtType, reconciled: 1 }), { status: 200 });
  }

  // ── payment.failed — log for ops visibility, do NOT flip status ──
  // Buyer may re-try payment; keep row pending_payment. Record failure in
  // refund_note field (repurposed for any payment-related annotation) so ops
  // can grep DB for "payment_failed:" tags.
  if (evtType === "payment.failed") {
    if (payment) {
      const razorpay_order_id: string = payment.order_id;
      const razorpay_payment_id: string = payment.id;
      const errCode: string = payment.error_code || "unknown";
      const errDesc: string = payment.error_description || "";
      const note = `payment_failed: ${errCode} ${errDesc.slice(0, 100)} (attempt ${razorpay_payment_id})`;
      // Only annotate — never overwrite existing refund_note.
      const { data: rows } = await sb
        .from("orders")
        .select("id, refund_note")
        .eq("razorpay_order_id", razorpay_order_id)
        .in("status", ["pending", "pending_payment", "payment_required"]);
      for (const r of (rows || [])) {
        const existing = (r as any).refund_note || "";
        const combined = existing ? `${existing}\n${note}` : note;
        await sb.from("orders").update({ refund_note: combined.slice(0, 1000) }).eq("id", (r as any).id);
      }
      console.log(`[razorpay-webhook] payment.failed logged on ${rows?.length ?? 0} row(s) for ${razorpay_order_id}`);
    }
    return new Response(JSON.stringify({ ok: true, event: "payment.failed", logged: true }), { status: 200 });
  }

  // Any other event — ack 200 so Razorpay doesn't retry.
  return new Response(JSON.stringify({ ok: true, ignored: evtType }), { status: 200 });
};
