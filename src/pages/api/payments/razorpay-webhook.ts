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

  if (!evtType || !payment) {
    return new Response(JSON.stringify({ error: "Malformed event" }), { status: 400 });
  }

  // Only act on captured payments. `payment.failed` acknowledged with 200 for now.
  if (evtType !== "payment.captured") {
    return new Response(JSON.stringify({ ok: true, ignored: evtType }), { status: 200 });
  }

  const razorpay_order_id: string = payment.order_id;
  const razorpay_payment_id: string = payment.id;

  const sb = createClient(supabaseUrl, supabaseServiceKey);

  // Idempotent flip: only orders still in pending states get updated.
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
    console.error("[razorpay-webhook] update failed", { razorpay_order_id, error: error.message });
    return new Response(JSON.stringify({ error: "Update failed" }), { status: 500 });
  }

  const reconciledCount = updated?.length ?? 0;
  if (reconciledCount === 0) {
    console.log("[razorpay-webhook] no pending row for", razorpay_order_id, "(already confirmed by client handler — OK)");
  } else {
    console.log("[razorpay-webhook] reconciled", reconciledCount, "row(s) for", razorpay_order_id);
  }

  return new Response(JSON.stringify({ ok: true, reconciled: reconciledCount }), { status: 200 });
};
