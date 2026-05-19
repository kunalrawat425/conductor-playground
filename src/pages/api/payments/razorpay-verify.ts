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

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id, buyer_id, buyer_email: clientBuyerEmail } = body;

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
    .select("id, buyer_id, status, total_price, delivery_fee, species, quantity, quantity_unit, order_type, razorpay_order_id, scheduled_for, pricing_option_id, listing:fish_listings(species, pricing_options, seller:sellers(id, name, email, location_name))")
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
  const { data: updatedRows, error: updateErr } = await supabase
    .from("orders")
    .update({
      status: "confirmed",
      payment_method: "razorpay",
      razorpay_payment_id,
      payment_verified_at: new Date().toISOString(),
      payment_verified_by: null,
    })
    .eq("id", order_id)
    .in("status", ["pending", "pending_payment"])
    .select("id");

  if (updateErr) {
    return new Response(JSON.stringify({ error: "Failed to confirm order" }), { status: 500 });
  }
  // Race guard: if 0 rows updated, another concurrent request already confirmed — idempotent OK.
  if (!updatedRows || updatedRows.length === 0) {
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

  // Send Razorpay receipt email to buyer — truly non-blocking
  if (resendApiKey) {
    const _order = order;
    supabase.from("buyers").select("email").eq("id", buyer_id).single().then(async ({ data: buyer }) => {
      const emailTo = buyer?.email || (clientBuyerEmail && typeof clientBuyerEmail === "string" ? clientBuyerEmail.trim() : null);
      if (!emailTo) return;
      // Patch email to buyers table if they don't have one yet
      if (!buyer?.email && emailTo) {
        supabase.from("buyers").update({ email: emailTo }).eq("id", buyer_id).then(() => {}).catch(() => {});
      }
      const { razorpayReceiptEmail } = await import("../../../lib/email-templates");
      const seller = (_order as any).listing?.seller;
      const qty = Number((_order as any).quantity) || 1;
      const qtyUnit = (_order as any).quantity_unit || "kg";
      const pricingOptionId = (_order as any).pricing_option_id || null;
      const pricingOptions = (_order as any).listing?.pricing_options;
      let bundleSize: number | null = null;
      let bundleCount: number | null = null;
      if (Array.isArray(pricingOptions) && pricingOptions.length > 0) {
        // Find option by id or by canonical opt_N index
        const opt = pricingOptionId
          ? pricingOptions.find((o: any, i: number) => o.id === pricingOptionId || `opt_${i}` === pricingOptionId)
          : pricingOptions[0];
        if (opt?.bundle_size && Number(opt.bundle_size) > 1) {
          bundleSize = Number(opt.bundle_size);
          bundleCount = Math.round(qty / bundleSize);
        }
      }
      const html = razorpayReceiptEmail({
        line_items: [{
          species: (_order as any).listing?.species || (_order as any).species || "Fish",
          quantity: qty,
          quantity_unit: qtyUnit,
          total_price: Number((_order as any).total_price) || 0,
          cut_style: null,
          buyer_notes: null,
          order_id,
          bundle_size: bundleSize,
          bundle_count: bundleCount,
        }],
        delivery_fee: Number((_order as any).delivery_fee) || 0,
        order_type: ((_order as any).order_type === "delivery" ? "delivery" : "pickup") as "pickup" | "delivery",
        seller_name: seller?.name || "Your seller",
        seller_location: seller?.location_name || null,
        buyer_addr: null,
        scheduled_for: (_order as any).scheduled_for || null,
        razorpay_payment_id,
        paid_at: new Date().toISOString(),
        primary_order_id: order_id,
      });
      if (html) {
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Relifish <noreply@relifish.store>",
            to: emailTo,
            subject: "Payment confirmed — your Relifish order is set ✓",
            html,
          }),
        }).catch(() => {});
      }
    }).catch(() => {});
  }

  // Notify seller — truly non-blocking
  const _sellerForEmail = (order as any).listing?.seller;
  if (_sellerForEmail?.email && resendApiKey) {
    (async () => {
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
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Relifish <noreply@relifish.store>",
          to: _sellerForEmail.email,
          subject: `New order paid: ${capitalizeFishName(species)}`,
          html,
        }),
      }).catch(() => {});

      // Seller push — new order paid
      const sellerId = (order as any).listing?.seller?.id;
      if (sellerId) {
        fetch(`${url.origin}/api/notify-seller`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            seller_id: sellerId,
            species: (order as any).listing?.species || (order as any).species || "Fish",
            quantity: (order as any).quantity,
            quantity_unit: (order as any).quantity_unit,
            placement_kind: (order as any).placement_kind || "same_day",
            order_id,
          }),
        }).catch(() => {});
      }
    })().catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
