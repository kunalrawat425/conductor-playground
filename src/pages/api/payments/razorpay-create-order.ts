import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const RAZORPAY_KEY_ID = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = import.meta.env.RAZORPAY_KEY_SECRET || "";

export const POST: APIRoute = async ({ request }) => {
  if (import.meta.env.PUBLIC_ENABLE_RAZORPAY !== "true") {
    return new Response(JSON.stringify({ error: "Razorpay is not enabled" }), { status: 400 });
  }
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return new Response(JSON.stringify({ error: "Payment gateway not configured" }), { status: 503 });
  }

  let body: { order_id?: string; buyer_id?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 });
  }

  const { order_id, buyer_id } = body;
  if (!order_id || !buyer_id) {
    return new Response(JSON.stringify({ error: "order_id and buyer_id required" }), { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Fetch order — verify ownership and status
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, buyer_id, total_price, delivery_fee, status, razorpay_order_id")
    .eq("id", order_id)
    .single();

  if (orderErr || !order) {
    return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
  }
  if (order.buyer_id !== buyer_id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
  }
  if (!["pending", "pending_payment"].includes(order.status)) {
    return new Response(
      JSON.stringify({ error: `Order status '${order.status}' cannot be paid via Razorpay` }),
      { status: 400 }
    );
  }

  // Idempotency — reuse existing Razorpay order ONLY if amount still matches.
  // If seller changed `final_price` between two Pay clicks, the cached
  // Razorpay order carries the OLD amount → buyer pays stale amount → verify.ts:66
  // rejects with "Payment does not match this order". Prevent that by
  // dropping the stale reference and creating a fresh Razorpay order.
  const amountPaise = Math.round(
    (Number(order.total_price) + Number(order.delivery_fee || 0)) * 100
  );
  if (order.razorpay_order_id) {
    // Ask Razorpay for the cached order's amount
    const authHex = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
    let cachedOk = false;
    try {
      const cachedRes = await fetch(`https://api.razorpay.com/v1/orders/${order.razorpay_order_id}`, {
        headers: { Authorization: `Basic ${authHex}` },
      });
      if (cachedRes.ok) {
        const cachedOrder = await cachedRes.json();
        cachedOk = Number(cachedOrder?.amount) === amountPaise;
      }
    } catch { /* network or malformed — cachedOk stays false, fall through to create new */ }

    if (cachedOk) {
      return new Response(
        JSON.stringify({
          razorpay_order_id: order.razorpay_order_id,
          amount: amountPaise,
          currency: "INR",
          key_id: RAZORPAY_KEY_ID,
        }),
        { status: 200 }
      );
    }
    // Amount drifted (or Razorpay lost the order) — clear stale ref and create new one below.
    await supabase.from("orders").update({ razorpay_order_id: null }).eq("id", order_id);
  }

  if (amountPaise <= 0) {
    return new Response(JSON.stringify({ error: "Order amount is zero" }), { status: 400 });
  }

  // Create Razorpay order via their API
  const credentials = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  let rzpResponse: Response;
  try {
    rzpResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt: order_id.slice(0, 40), // Razorpay receipt max 40 chars
      }),
    });
  } catch {
    return new Response(JSON.stringify({ error: "Could not reach payment gateway" }), { status: 502 });
  }

  if (!rzpResponse.ok) {
    const errBody = await rzpResponse.json().catch(() => ({}));
    const msg = (errBody as any)?.error?.description || "Payment gateway error";
    return new Response(JSON.stringify({ error: msg }), { status: 502 });
  }

  const rzpOrder = await rzpResponse.json();
  const razorpay_order_id: string = rzpOrder.id;

  // Store Razorpay order ID on our order row
  const { error: updateErr } = await supabase
    .from("orders")
    .update({ razorpay_order_id })
    .eq("id", order_id);

  if (updateErr) {
    return new Response(JSON.stringify({ error: "Failed to save payment reference" }), { status: 500 });
  }

  return new Response(
    JSON.stringify({
      razorpay_order_id,
      amount: amountPaise,
      currency: "INR",
      key_id: RAZORPAY_KEY_ID,
    }),
    { status: 200 }
  );
};
