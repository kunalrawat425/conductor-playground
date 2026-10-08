import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const RAZORPAY_KEY_ID = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = import.meta.env.RAZORPAY_KEY_SECRET || "";

/**
 * POST /api/seller/reconcile-razorpay
 * Body: { order_id, seller_id }
 * Manual escape hatch for sellers when a Razorpay payment hasn't reflected.
 * Queries Razorpay for captured payments on that order and, if found, flips
 * the DB row to confirmed. Complements the automatic webhook (razorpay-webhook.ts).
 */
export const POST: APIRoute = async ({ request }) => {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return new Response(JSON.stringify({ error: "Payment gateway not configured" }), { status: 503 });
  }

  let body: { order_id?: string; seller_id?: string; seller_phone?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 });
  }

  const { order_id, seller_id, seller_phone } = body;
  if (!order_id || !seller_id) {
    return new Response(JSON.stringify({ error: "order_id and seller_id required" }), { status: 400 });
  }

  // BUG-12: verify seller_phone matches
  const { assertSellerOwns } = await import("../../../lib/server/assert-seller");
  const authCheck = await assertSellerOwns(seller_id, seller_phone);
  if (authCheck instanceof Response) return authCheck;

  const sb = createClient(supabaseUrl, supabaseServiceKey);

  // Fetch order + verify seller owns it
  const { data: order, error: orderErr } = await sb
    .from("orders")
    .select("id, status, razorpay_order_id, listing:fish_listings(seller_id)")
    .eq("id", order_id)
    .single();

  if (orderErr || !order) {
    return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
  }

  if ((order as any).listing?.seller_id !== seller_id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
  }

  if (!order.razorpay_order_id) {
    return new Response(JSON.stringify({ ok: false, reason: "No Razorpay order on this row — buyer hasn't clicked Pay yet" }), { status: 200 });
  }

  if (order.status === "confirmed") {
    return new Response(JSON.stringify({ ok: true, already_confirmed: true }), { status: 200 });
  }

  // Query Razorpay for payments on this order
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  let rzpRes: Response;
  try {
    rzpRes = await fetch(`https://api.razorpay.com/v1/orders/${order.razorpay_order_id}/payments`, {
      headers: { Authorization: `Basic ${auth}` },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Could not reach payment gateway" }), { status: 502 });
  }

  if (!rzpRes.ok) {
    const errBody = await rzpRes.json().catch(() => ({}));
    const msg = (errBody as any)?.error?.description || "Payment gateway error";
    return new Response(JSON.stringify({ error: msg }), { status: 502 });
  }

  const rzpData = await rzpRes.json();
  const captured = Array.isArray(rzpData.items)
    ? rzpData.items.find((p: any) => p?.status === "captured")
    : null;

  if (!captured) {
    return new Response(JSON.stringify({
      ok: false,
      reason: "No captured payment found on Razorpay for this order",
      attempts_at_razorpay: rzpData.count || 0,
    }), { status: 200 });
  }

  // Same settle rules as verify/webhook/cron: confirm, attach, or refund.
  const { settleCapturedPayment } = await import("../../../lib/server/razorpay-ledger");
  let settled;
  try {
    settled = await settleCapturedPayment(sb, {
      razorpay_order_id: order.razorpay_order_id, razorpay_payment_id: captured.id, source: "seller", verified_by: seller_id,
    });
  } catch (err: any) {
    console.error("[reconcile-razorpay] settle failed", { order_id, error: err?.message });
    return new Response(JSON.stringify({ error: "Failed to reconcile" }), { status: 500 });
  }
  if (settled.kind === "refunded") {
    return new Response(JSON.stringify({ ok: true, refunded: true, payment_id: captured.id }), { status: 200 });
  }
  if (settled.kind !== "confirmed") {
    // Someone else confirmed between our SELECT and settle. Still success.
    return new Response(JSON.stringify({ ok: true, already_confirmed: true, payment_id: captured.id }), { status: 200 });
  }

  return new Response(JSON.stringify({ ok: true, reconciled: true, payment_id: captured.id }), { status: 200 });
};
