import { createHmac } from "node:crypto";
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const RAZORPAY_KEY_SECRET = import.meta.env.RAZORPAY_KEY_SECRET || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

export const POST: APIRoute = async ({ request, url }) => {
  if (import.meta.env.PUBLIC_ENABLE_RAZORPAY !== "true") {
    return new Response(JSON.stringify({ error: "Razorpay is not enabled" }), { status: 400 });
  }
  if (!RAZORPAY_KEY_SECRET) {
    return new Response(JSON.stringify({ error: "Payment gateway not configured" }), { status: 503 });
  }

  let body: {
    razorpay_order_id?: string;
    razorpay_payment_id?: string;
    razorpay_signature?: string;
    order_id?: string;
    buyer_id?: string;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id, buyer_id } = body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !order_id || !buyer_id) {
    return new Response(JSON.stringify({ error: "All payment fields required" }), { status: 400 });
  }

  // HMAC-SHA256 signature verification
  const expectedSignature = createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return new Response(JSON.stringify({ error: "Invalid payment signature" }), { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Fetch order — verify ownership and guard against replay
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, buyer_id, status, total_price, delivery_fee, species, quantity, quantity_unit, order_type, razorpay_order_id, seller:sellers(id, name, email, location_name), scheduled_for, listing:fish_listings(species)")
    .eq("id", order_id)
    .single();

  if (orderErr || !order) {
    return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
  }
  if (order.buyer_id !== buyer_id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
  }
  // Cross-check: razorpay_order_id must match what was stored when the order was created.
  // Prevents replay: attacker paying ₹1 on a real Razorpay order and replaying the valid
  // signature against a different (higher-value) order_id they own as buyer.
  if ((order as any).razorpay_order_id !== razorpay_order_id) {
    return new Response(JSON.stringify({ error: "Payment does not match this order" }), { status: 400 });
  }
  // Replay guard — already confirmed orders must not be re-confirmed
  if (!["pending", "pending_payment"].includes(order.status)) {
    // If already confirmed via this payment, return success (idempotent)
    if (order.status === "confirmed") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ error: `Order already in status: ${order.status}` }),
      { status: 400 }
    );
  }

  // Atomically confirm the order
  const { error: updateErr, count: updatedCount } = await supabase
    .from("orders")
    .update({
      status: "confirmed",
      payment_method: "razorpay",
      razorpay_payment_id,
      payment_verified_at: new Date().toISOString(),
      payment_verified_by: null, // null = system auto-verified
    })
    .eq("id", order_id)
    .in("status", ["pending", "pending_payment"]) // double-check — only update if still payable
    .select();

  if (updateErr) {
    return new Response(JSON.stringify({ error: "Failed to confirm order" }), { status: 500 });
  }
  // Race guard: if count is 0 another concurrent request already confirmed — return idempotent
  // success without re-firing push/email notifications.
  if (!updatedCount || updatedCount === 0) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // Fire buyer push notification (non-blocking)
  try {
    const { sendBuyerOrderPush } = await import("../../../lib/server/buyer-push");
    await sendBuyerOrderPush({
      buyer_id,
      buyer_phone: undefined,
      status: "confirmed",
      species: (order as any).listing?.species || (order as any).species || "Fish",
      order_id,
    });
  } catch { /* non-blocking */ }

  // Send Razorpay receipt email to buyer (non-blocking)
  if (resendApiKey) {
    try {
      const { data: buyer } = await supabase
        .from("buyers")
        .select("email")
        .eq("id", buyer_id)
        .single();

      if (buyer?.email) {
        const { razorpayReceiptEmail } = await import("../../../lib/email-templates");
        const seller = (order as any).seller;
        const html = razorpayReceiptEmail({
          line_items: [{
            species: (order as any).listing?.species || (order as any).species || "Fish",
            quantity: Number((order as any).quantity) || 1,
            quantity_unit: (order as any).quantity_unit || "kg",
            total_price: Number((order as any).total_price) || 0,
            cut_style: null,
            buyer_notes: null,
            order_id,
          }],
          delivery_fee: Number((order as any).delivery_fee) || 0,
          order_type: ((order as any).order_type === "delivery" ? "delivery" : "pickup") as "pickup" | "delivery",
          seller_name: seller?.name || "Your seller",
          seller_location: seller?.location_name || null,
          buyer_addr: null,
          scheduled_for: (order as any).scheduled_for || null,
          razorpay_payment_id,
          paid_at: new Date().toISOString(),
          primary_order_id: order_id,
        });

        if (html) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "Relifish <noreply@relifish.store>",
              to: buyer.email,
              subject: "Payment confirmed — your Relifish order is set ✓",
              html,
            }),
          });
        }
      }
    } catch { /* non-blocking */ }
  }

  // Notify seller (non-blocking)
  try {
    const seller = (order as any).seller;
    if (seller?.email && resendApiKey) {
      const { orderEmailSeller, capitalizeFishName } = await import("../../../lib/email-templates");
      const species = (order as any).listing?.species || (order as any).species || "Fish";
      const html = orderEmailSeller({
        statusLabel: "Paid via Razorpay — auto-confirmed",
        species,
        quantity: Number((order as any).quantity) || 1,
        quantity_unit: (order as any).quantity_unit || "kg",
        totalAmount: Number((order as any).total_price) + Number((order as any).delivery_fee || 0),
        deliveryFee: Number((order as any).delivery_fee) || 0,
        orderId: order_id,
        scheduled_for: (order as any).scheduled_for || null,
        buyerPhone: undefined,
      });
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Relifish <noreply@relifish.store>",
          to: seller.email,
          subject: `New order paid: ${capitalizeFishName(species)}`,
          html,
        }),
      });
    }
  } catch { /* non-blocking */ }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
