import { createHmac } from "node:crypto";
import { MAIL_FROM } from "../../../lib/server/send-email";
import { requireBuyer } from "../../../lib/server/session";
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { internalHeaders } from "../../../lib/server/internal-auth";
import { afterResponse } from "../../../lib/server/after-response";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const RAZORPAY_KEY_SECRET = import.meta.env.RAZORPAY_KEY_SECRET || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

export const POST: APIRoute = async ({ request, url }) => {
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
    .select("id, buyer_id, status, total_price, delivery_fee, final_price, paid_amount, species, quantity, quantity_unit, order_type, razorpay_order_id, scheduled_for, pricing_option_id, listing:fish_listings(species, pricing_options, seller:sellers(id, name, email, location_name))")
    .eq("id", order_id)
    .single();

  if (orderErr || !order) {
    return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
  }
  if (order.buyer_id !== buyer_id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
  }
  // Cross-check: the signed Razorpay order must belong to THIS order. Prevents
  // replay: paying ₹1 on one order and replaying that signature against a
  // different (higher-value) order the same buyer owns. The receipt fallback in
  // findOrderForRazorpayOrder also covers an id replaced after a price change.
  // A cart paid in one go: the signed Razorpay order covers every row of the
  // cart, so this order must be one of them.
  const { findOrdersForRazorpayOrder, settleCapturedPayment } = await import("../../../lib/server/razorpay-ledger");
  const owners = await findOrdersForRazorpayOrder(supabase, razorpay_order_id);
  if (!owners.some((r) => r.id === order_id) || owners.some((r) => r.buyer_id !== buyer_id)) {
    return new Response(JSON.stringify({ error: "Payment does not match this order" }), { status: 400 });
  }

  // Confirm, attach, or refund — decided once, shared with the webhook and crons.
  let settled;
  try {
    settled = await settleCapturedPayment(supabase, { razorpay_order_id, razorpay_payment_id, source: "verify" });
  } catch (err: any) {
    console.error("[razorpay-verify] settle failed", { order_id, razorpay_payment_id, err: err?.message });
    return new Response(JSON.stringify({ error: "Failed to confirm order" }), { status: 500 });
  }
  if (settled.kind === "refunded") {
    return new Response(JSON.stringify({
      error: settled.refund.ok
        ? "This order was already closed or paid, so this payment is being refunded to you."
        : "This order was already closed or paid. We could not refund this payment automatically — support will refund it.",
      error_code: "payment_refunded",
    }), { status: 409 });
  }
  // already / stamped / orphan: someone else did the work (or nothing to do) — idempotent OK.
  if (settled.kind !== "confirmed") {
    return new Response(JSON.stringify({ ok: true, ga_server: !!import.meta.env.GA4_API_SECRET }), { status: 200 });
  }

  // Every row this payment confirmed (a whole cart → ONE push, ONE receipt, ONE seller email).
  const paidIds = (settled.orders?.length ? settled.orders : [settled.order]).map((r) => r.id);
  const { data: paidRowsData } = await supabase
    .from("orders")
    .select("id, species, quantity, quantity_unit, total_price, delivery_fee, pricing_option_id, pricing_label, cut_style, buyer_notes, created_at, listing:fish_listings(species, pricing_options)")
    .in("id", paidIds)
    .order("created_at", { ascending: true });
  const paidRows: any[] = paidRowsData?.length ? paidRowsData : [order];
  const { cartLabel } = await import("../../../lib/server/order-cart");
  const speciesOf = (r: any) => r.listing?.species || r.species || "Fish";
  const label = paidRows.length > 1 ? cartLabel(paidRows.map(speciesOf)) : speciesOf(order);
  const cartFee = paidRows.reduce((s: number, r: any) => s + (Number(r.delivery_fee) || 0), 0);
  const cartTotal = paidRows.reduce((s: number, r: any) => s + (Number(r.total_price) || 0), 0) + cartFee;
  const bundleOf = (r: any) => {
    const opts = r.listing?.pricing_options;
    if (!Array.isArray(opts) || !opts.length) return { size: null as number | null, count: null as number | null };
    // Find option by id or by canonical opt_N index
    const opt = r.pricing_option_id
      ? opts.find((o: any, i: number) => o.id === r.pricing_option_id || `opt_${i}` === r.pricing_option_id)
      : opts[0];
    const size = opt?.bundle_size && Number(opt.bundle_size) > 1 ? Number(opt.bundle_size) : null;
    return { size, count: size ? Math.round((Number(r.quantity) || 1) / size) : null };
  };

  // Buyer push goes out after the response (waitUntil): awaiting it here held the
  // "payment confirmed" screen for several seconds on staging.
  afterResponse((async () => {
    const { sendBuyerOrderPush } = await import("../../../lib/server/buyer-push");
    await sendBuyerOrderPush({
      buyer_id,
      buyer_phone: undefined,
      status: settled.order.status === "confirmed" ? "confirmed" : "paid",
      species: label,
      order_id,
    });
  })(), "razorpay-verify:buyer-push");

  // BUG-27: these used to be fire-and-forget. Vercel freezes the function once
  // the response is returned, so the receipt email and the seller notification
  // were being killed in flight on exactly the payment-confirmation path.
  // Collected here and awaited before we respond.
  const pending: Promise<unknown>[] = [];

  // Send Razorpay receipt email to buyer
  if (resendApiKey) {
    const _order = order;
    pending.push(supabase.from("buyers").select("email").eq("id", buyer_id).single().then(async ({ data: buyer }) => {
      const emailTo = buyer?.email || (clientBuyerEmail && typeof clientBuyerEmail === "string" ? clientBuyerEmail.trim() : null);
      if (!emailTo) return;
      // Patch email to buyers table if they don't have one yet
      if (!buyer?.email && emailTo) {
        // Only the logged-in buyer may change their own email (client-supplied value).
        if (!requireBuyer(request, buyer_id)) await supabase.from("buyers").update({ email: emailTo }).eq("id", buyer_id);
      }
      const { razorpayReceiptEmail } = await import("../../../lib/email-templates");
      const seller = (_order as any).listing?.seller;
      const html = razorpayReceiptEmail({
        line_items: paidRows.map((r: any) => {
          const b = bundleOf(r);
          return {
            species: speciesOf(r),
            quantity: Number(r.quantity) || 1,
            quantity_unit: r.quantity_unit || "kg",
            total_price: Number(r.total_price) || 0,
            cut_style: r.cut_style || null,
            buyer_notes: r.buyer_notes || null,
            order_id: r.id,
            bundle_size: b.size,
            bundle_count: b.count,
          };
        }),
        delivery_fee: cartFee,
        order_type: ((_order as any).order_type === "delivery" ? "delivery" : "pickup") as "pickup" | "delivery",
        seller_name: seller?.name || "Your seller",
        seller_location: seller?.location_name || null,
        buyer_addr: null,
        scheduled_for: (_order as any).scheduled_for || null,
        razorpay_payment_id,
        paid_at: new Date().toISOString(),
        primary_order_id: paidRows[0]?.id || order_id,
      });
      if (html) {
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: MAIL_FROM,
            to: emailTo,
            subject: "Payment received — waiting for the seller to confirm",
            html,
          }),
        }).catch((err) => console.warn("[razorpay-verify] buyer receipt email failed", { order_id, err: err?.message || String(err) }));
      }
    }).catch((err) => console.warn("[razorpay-verify] buyer email lookup failed", { order_id, err: err?.message || String(err) })));
  }

  // Notify seller — truly non-blocking
  const _sellerForEmail = (order as any).listing?.seller;
  if (_sellerForEmail?.email && resendApiKey) {
    pending.push((async () => {
      const { orderEmailSeller, capitalizeFishName } = await import("../../../lib/email-templates");
      const species = label;
      const html = orderEmailSeller({
        statusLabel: "Paid — open your dashboard to confirm or decline",
        species,
        quantity: Number((order as any).quantity) || 1,
        quantity_unit: (order as any).quantity_unit || "kg",
        totalAmount: cartTotal,
        deliveryFee: cartFee,
        orderId: paidRows[0]?.id || order_id,
        scheduled_for: (order as any).scheduled_for || null,
        buyerPhone: undefined,
        items: paidRows.map((r: any) => {
          const b = bundleOf(r);
          return { species: speciesOf(r), quantity: Number(r.quantity) || 1, quantity_unit: r.quantity_unit || "kg",
            total_price: Number(r.total_price) || 0, pricingLabel: r.pricing_label || null, bundleSize: b.size, bundleCount: b.count };
        }),
      });
      const sellerEmailReq = fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: MAIL_FROM,
          to: _sellerForEmail.email,
          subject: `New paid order — please confirm: ${capitalizeFishName(species)}`,
          html,
        }),
      }).catch((err) => console.warn("[razorpay-verify] seller email failed", { order_id, err: err?.message || String(err) }));
      await sellerEmailReq;

      // Seller push — new order paid
      const sellerId = (order as any).listing?.seller?.id;
      if (sellerId) {
        await fetch(`${url.origin}/api/notify-seller`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...internalHeaders() },
          body: JSON.stringify({
            seller_id: sellerId,
            species: label,
            item_count: paidRows.length,
            quantity: (order as any).quantity,
            quantity_unit: (order as any).quantity_unit,
            placement_kind: (order as any).placement_kind || "same_day",
            order_id,
            order_id_short: String(order_id).slice(0, 8),
            // BUG-26: the seller already got a "New order" push at creation time;
            // this one is the payment landing, so it must read differently.
            kind: "payment_confirmed",
            amount: cartTotal,
          }),
        }).catch((err) => console.warn("[razorpay-verify] seller push failed", { order_id, err: err?.message || String(err) }));
      }
    })().catch((err) => console.warn("[razorpay-verify] seller notify block failed", { order_id, err: err?.message || String(err) })));
  }

  afterResponse(Promise.allSettled(pending), "razorpay-verify:notify");

  return new Response(JSON.stringify({ ok: true, ga_server: !!import.meta.env.GA4_API_SECRET }), { status: 200 });
};
