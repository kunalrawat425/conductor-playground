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
 *   Events: payment.captured, payment.failed
 *   Secret: same value as env RAZORPAY_WEBHOOK_SECRET
 */
export const POST: APIRoute = async ({ request }) => {
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

    const { data: updated, error } = await sb
      .from("orders")
      .update({
        status: "confirmed",
        payment_method: "razorpay",
        razorpay_payment_id,
        payment_verified_at: new Date().toISOString(),
        payment_verified_by: null,
      })
      .eq("razorpay_order_id", razorpay_order_id)
      .in("status", ["pending", "pending_payment"])
      .select("id, buyer_id");

    if (error) {
      console.error("[razorpay-webhook] captured update failed", { razorpay_order_id, error: error.message });
      return new Response(JSON.stringify({ error: "Update failed" }), { status: 500 });
    }

    const n = updated?.length ?? 0;
    console.log(n === 0
      ? `[razorpay-webhook] no pending row for ${razorpay_order_id} (already confirmed — OK)`
      : `[razorpay-webhook] captured: reconciled ${n} row(s) for ${razorpay_order_id}`);
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

    // Match by razorpay_payment_id (captured refunds always have this).
    const { data: updated, error } = await sb
      .from("orders")
      .update({
        status: "refunded",
        refund_note: `Razorpay refund ${refund_id} (${evtType})`,
        refund_amt: refund_amt_paise / 100,
        refund_sent_at: new Date().toISOString(),
      })
      .eq("razorpay_payment_id", razorpay_payment_id)
      .not("status", "eq", "refunded")
      .select("id");

    if (error) {
      console.error("[razorpay-webhook] refund update failed", { razorpay_payment_id, error: error.message });
      return new Response(JSON.stringify({ error: "Update failed" }), { status: 500 });
    }
    const n = updated?.length ?? 0;
    console.log(n === 0
      ? `[razorpay-webhook] no matching order for payment ${razorpay_payment_id} (may be legacy or already refunded)`
      : `[razorpay-webhook] ${evtType}: reconciled ${n} row(s) for payment ${razorpay_payment_id}`);
    return new Response(JSON.stringify({ ok: true, event: evtType, reconciled: n }), { status: 200 });
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
        .in("status", ["pending", "pending_payment"]);
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
