import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { sendBuyerOrderPush } from "../../../lib/server/buyer-push";
import { sendTransactionalEmail } from "../../../lib/server/send-email";
import { isRazorpayPaid, refundRazorpayPayment } from "../../../lib/server/razorpay-refund";
import { preorderNeedsFinalPrice } from "../../../lib/order-payment-state";
import { refundOrderRazorpay } from "../../../lib/server/razorpay-ledger";
import { orderEmailBuyer, orderEmailSeller } from "../../../lib/email-templates";

function capitalizeFishName(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

const STATUS_LABELS: Record<string, string> = {
  pending: "Order Placed",
  pending_payment: "Payment Pending",
  confirmed: "Order Confirmed",
  paid: "Payment Received",
  payment_required: "Additional Payment Required",
  ready_for_pickup: "Ready for Pickup",
  out_for_delivery: "Out for Delivery",
  picked_up: "Order Picked Up",
  completed: "Order Completed",
  declined: "Order Declined",
  cancelled: "Order Cancelled",
  refunded: "Refund Processed",
  scheduled: "Order Scheduled",
  pre_order: "Pre-order Placed",
};

/**
 * POST /api/seller/orders
 * Body: { seller_id, order_id, status?, action?, final_price? }
 * action=set_final_price: calls reconcile_preorder_price RPC (refunds a price drop on Razorpay)
 * Otherwise: status transition
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { seller_id, seller_phone, order_id, status, action, final_price, refund_note } = await request.json();

    if (!seller_id || !order_id) {
      return new Response(JSON.stringify({ error: "seller_id and order_id required" }), { status: 400 });
    }
    if (!action && !status) {
      return new Response(JSON.stringify({ error: "action or status required" }), { status: 400 });
    }

    // BUG-12: verify seller_phone matches the seller row.
    // seller_id is publicly exposed via /api/search so cannot be a bearer alone.
    const { assertSellerOwns } = await import("../../../lib/server/assert-seller");
    const authCheck = await assertSellerOwns(seller_id, seller_phone);
    if (authCheck instanceof Response) return authCheck;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify order belongs to this seller's listings
    const { data: order, error: orderFetchErr } = await supabase
      .from("orders")
      .select("listing_id, buyer_id, buyer_phone, species, status, paid_amount, final_price, refund_amt, payment_screenshot_urls, payment_method, payment_verified_at, razorpay_payment_id")
      .eq("id", order_id)
      .single();

    if (orderFetchErr || !order) {
      return new Response(
        JSON.stringify({ error: orderFetchErr?.message || "Order not found" }),
        { status: orderFetchErr ? 500 : 404 }
      );
    }

    if (order.listing_id) {
      const { data: listing } = await supabase
        .from("fish_listings")
        .select("seller_id")
        .eq("id", order.listing_id)
        .single();

      if (!listing || listing.seller_id !== seller_id) {
        return new Response(JSON.stringify({ error: "Not your order" }), { status: 403 });
      }
    } else {
      // No listing anchor — deny (can't verify ownership without listing)
      return new Response(JSON.stringify({ error: "Order ownership cannot be verified" }), { status: 403 });
    }

    // action=set_final_price: use reconcile_preorder_price RPC
    if (action === "set_final_price") {
      if (final_price === undefined || final_price === null) {
        return new Response(JSON.stringify({ error: "final_price required for set_final_price" }), { status: 400 });
      }
      const parsedFinal = Number(final_price);
      if (!Number.isFinite(parsedFinal) || parsedFinal <= 0) {
        return new Response(JSON.stringify({ error: "final_price must be a positive number" }), { status: 400 });
      }
      if (order.paid_amount === null || order.paid_amount === undefined || !order.razorpay_payment_id) {
        return new Response(JSON.stringify({ error: "Set the final price once the buyer's payment is in" }), { status: 400 });
      }
      if (order.final_price !== null && order.final_price !== undefined) {
        return new Response(JSON.stringify({ error: "Final price already set for this order" }), { status: 400 });
      }
      if (!["confirmed", "paid"].includes(String(order.status || ""))) {
        return new Response(JSON.stringify({ error: "Set final price once the order is confirmed" }), { status: 400 });
      }
      const { data: newStatus, error: rpcErr } = await supabase.rpc("reconcile_preorder_price", {
        p_order_id: order_id,
        p_final_price: parsedFinal,
      });
      if (rpcErr) {
        return new Response(JSON.stringify({ error: rpcErr.message }), { status: 500 });
      }
      let { data, error: fetchErr } = await supabase.from("orders").select().eq("id", order_id).single();
      if (fetchErr) {
        return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
      }
      // Catch priced in lower than the pre-order max the buyer paid: refund the
      // difference on Razorpay right away. It used to sit in refund_amt and the
      // seller was told to send it over UPI — but the money is in the platform's
      // Razorpay account, not the seller's.
      const dueBack = Number((data as any)?.refund_amt) || 0;
      if (newStatus === "confirmed" && dueBack > 0 && isRazorpayPaid(data as any) && !(data as any).refund_sent_at) {
        const outcome = await refundRazorpayPayment(
          String((data as any).razorpay_payment_id),
          { order_id, caller: "seller/orders:set_final_price" },
          Math.round(dueBack * 100)
        );
        const patch: Record<string, unknown> = { refund_note: `Price set at ₹${parsedFinal}: ${outcome.note}` };
        if (outcome.ok) patch.refund_sent_at = new Date().toISOString();
        const upd = await supabase.from("orders").update(patch).eq("id", order_id).select().single();
        if (upd.error) console.error("[seller/orders] partial refund recorded on Razorpay but not on the order", { order_id, refund: outcome.refundId, err: upd.error.message });
        else data = upd.data;
      }
      if (order.buyer_id || order.buyer_phone) {
        try {
          await sendBuyerOrderPush({
            buyer_id: order.buyer_id,
            buyer_phone: order.buyer_phone,
            status: newStatus,
            species: order.species || "Fish",
            final_price,
            order_id,
          });
        } catch (err) { console.warn("[seller/orders] set_final_price buyer push failed", { order_id, err: (err as any)?.message }); }
      }
      return new Response(JSON.stringify({ order: data, reconciled_status: newStatus }), { status: 200 });
    }

    // Razorpay is the only payment method: no manual UPI verification and no
    // "mark refund sent" — refunds go back through Razorpay automatically.
    if (action) {
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }

    // Default: status transition
    const validTransitions: Record<string, string[]> = {
      pending: ["confirmed", "declined"],
      pending_payment: ["confirmed", "declined"],
      pre_order: ["confirmed", "declined"],
      scheduled: ["confirmed", "declined"],
      confirmed: ["ready_for_pickup", "out_for_delivery", "declined", "cancelled"],
      paid: ["ready_for_pickup", "out_for_delivery", "declined", "cancelled"],
      payment_required: ["confirmed", "cancelled"],
      // `refunded`, `completed`, `declined`, `cancelled` are terminal: no exits.
      // `refunded` used to allow Ready/Out (for pre-BUG-43 price-drop rows), so a
      // fully refunded order could be "fulfilled" again. Prod has none of those rows.
      ready_for_pickup: ["completed", "cancelled"],
      out_for_delivery: ["completed", "cancelled"],
    };
    const { data: currentOrder } = await supabase
      .from("orders")
      .select("status, paid_amount, final_price, payment_screenshot_urls, total_price, delivery_fee, payment_method, payment_verified_at, razorpay_payment_id, razorpay_order_id, is_preorder, placement_kind, pricing_option_id, quantity, quantity_unit, listing:fish_listings(pricing_options)")
      .eq("id", order_id)
      .single();
    const currentStatus = currentOrder?.status;

    // Razorpay is the only payment method: an order is confirmed only once its
    // payment is captured (settle confirms it automatically; this covers the
    // seller's "Confirm order" for a paid row whose confirm write was lost).
    if (status === "confirmed" && !(currentOrder as any)?.razorpay_payment_id) {
      return new Response(
        JSON.stringify({ error: "Confirm only after the buyer has paid. Use “Check Razorpay for payment”." }),
        { status: 400 }
      );
    }
    // A status missing from the map used to skip this check entirely, so
    // `cancelled → confirmed` or `completed → declined` were accepted.
    if (!currentStatus || !validTransitions[currentStatus]?.includes(status)) {
      return new Response(JSON.stringify({ error: `Cannot change from ${currentStatus} to ${status}` }), { status: 400 });
    }
    // Pre-orders priced on a range must have their catch price set before
    // fulfilment (same rule as the dashboard's "Set price" button).
    const tryingToFulfill = status === "ready_for_pickup" || status === "out_for_delivery";
    if (tryingToFulfill && preorderNeedsFinalPrice(currentOrder as any)) {
      return new Response(
        JSON.stringify({ error: "Set final price first before moving preorder to pickup/delivery" }),
        { status: 400 }
      );
    }

    // final_price is only ever set through action=set_final_price (validated, and
    // reconciled by the RPC). Writing it here unvalidated skipped refund_amt.
    const updates: any = { status };
    if (status === "declined" || status === "cancelled") {
      updates.cancelled_by = "seller";
      if (refund_note) updates.refund_note = refund_note;

      // BUG-44: this branch used to write cancelled_by/refund_note and stop —
      // no Razorpay refund was ever issued. The dashboard button says
      // "✓ Confirm — refund buyer" and the resulting card tells the seller to
      // send the money over UPI, but for a Razorpay order the funds sit in the
      // PLATFORM's Razorpay account, not the seller's, so the buyer got nothing
      // unless someone noticed and refunded by hand. The buyer-initiated cancel
      // path has always refunded properly; now both use the same helper.
      if (isRazorpayPaid(currentOrder as any)) {
        // Every payment on the order: upfront plus any balance top-up.
        const outcome = await refundOrderRazorpay(
          supabase,
          { id: order_id, razorpay_payment_id: (currentOrder as any).razorpay_payment_id, razorpay_order_id: (currentOrder as any).razorpay_order_id },
          { caller: `seller/orders:${status}` }
        );
        updates.refund_note = refund_note ? `${refund_note} — ${outcome.note}` : outcome.note;
        if (outcome.ok) {
          updates.refund_amt = Number((currentOrder as any).paid_amount)
            || (Number((currentOrder as any).total_price) + Number((currentOrder as any).delivery_fee || 0));
          updates.refund_sent_at = new Date().toISOString();
        }
      }
    }
    // Stamp payment_verified_at if a paid row reached here without it.
    if (status === "confirmed" && !(currentOrder as any)?.payment_verified_at) {
      updates.payment_verified_at = new Date().toISOString();
      updates.payment_verified_by = seller_id;
    }

    // Guard on the status we validated against: a concurrent buyer cancel or a
    // second click must not be overwritten (e.g. a refunded order flipped to Ready).
    const { data: rows, error } = await supabase
      .from("orders")
      .update(updates)
      .eq("id", order_id)
      .eq("status", currentStatus)
      .select();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    const data = rows?.[0];
    if (!data) {
      return new Response(JSON.stringify({ error: "This order was just updated. Refresh and try again." }), { status: 409 });
    }

    // Notify buyer via push — never fail the order update if push throws
    if (order.buyer_id || order.buyer_phone) {
      try {
        const pushResult = await sendBuyerOrderPush({
          buyer_id: order.buyer_id,
          buyer_phone: order.buyer_phone,
          status,
          species: order.species || "Fish",
          final_price: final_price ?? null,
          order_id,
        });
        if (!pushResult.ok) {
          console.error("Buyer push failed:", pushResult.error);
        } else if (!pushResult.sent) {
          console.info("Buyer push skipped:", pushResult.reason);
        }
      } catch (pushErr: any) {
        console.error("Buyer push exception:", pushErr?.message || pushErr);
      }
    }

    // Send email notifications to buyer and seller
    try {
      const statusLabel = STATUS_LABELS[status] || status;
      const species = capitalizeFishName(order.species || "Fish");
      const totalAmount = final_price ? Number(final_price) : Number(data.total_price) || 0;
      const isPreorder = (currentOrder as any)?.is_preorder === true || (currentOrder as any)?.placement_kind === "preorder";
      const qty = Number(data.quantity) || 0;
      const qtyUnit = data.quantity_unit || "piece";
      const pricingOptionId = (currentOrder as any)?.pricing_option_id;
      const pricingOptions = (currentOrder as any)?.listing?.pricing_options;
      let bundleSize: number | null = null;
      let bundleCount: number | null = null;
      if (Array.isArray(pricingOptions) && pricingOptions.length > 0) {
        const opt = pricingOptionId
          ? pricingOptions.find((o: any, i: number) => o.id === pricingOptionId || `opt_${i}` === pricingOptionId)
          : pricingOptions[0];
        if (opt?.bundle_size && Number(opt.bundle_size) > 1) {
          bundleSize = Number(opt.bundle_size);
          bundleCount = Math.round(qty / bundleSize);
        }
      }
      const emailArgs = {
        statusLabel,
        species,
        quantity: qty,
        quantity_unit: qtyUnit,
        totalAmount: totalAmount + (Number(data.delivery_fee) || 0),
        deliveryFee: Number(data.delivery_fee) || 0,
        orderId: order_id,
        scheduled_for: data.scheduled_for || null,
        buyerNotes: data.buyer_notes || null,
        cutStyle: data.cut_style || null,
        isPreorder,
        bundleSize,
        bundleCount,
      };

      // Email buyer (if they have email)
      if (order.buyer_id) {
        const { data: buyer } = await supabase.from("buyers").select("email").eq("id", order.buyer_id).single();
        if (buyer?.email) {
          await sendTransactionalEmail(buyer.email, `${statusLabel} — ${species}`, orderEmailBuyer(emailArgs));
        }
      }

      // Email seller
      const { data: seller } = await supabase.from("sellers").select("email, push_subscription, push_enabled").eq("id", seller_id).single();
      if (seller?.email) {
        await sendTransactionalEmail(seller.email, `Order Update: ${statusLabel} — ${species}`, orderEmailSeller(emailArgs));
      }

      // Seller push for cancelled/declined (seller needs confirmation their action was processed)
      if (["cancelled", "declined"].includes(status) && seller?.push_subscription) {
        try {
          const { loadWebPush } = await import("../../../lib/server/load-web-push");
          const { normalizeVapidKeyForWebPush, trimVapidKey } = await import("../../../lib/server/vapid-env");
          const { absoluteUrl } = await import("../../../lib/server/site-origin");
          const vapidPub = normalizeVapidKeyForWebPush(import.meta.env.PUBLIC_VAPID_KEY || "");
          const vapidPriv = normalizeVapidKeyForWebPush(import.meta.env.VAPID_PRIVATE_KEY || "");
          const vapidContact = trimVapidKey(import.meta.env.VAPID_CONTACT || "") || "mailto:relifishstore@gmail.com";
          if (vapidPub && vapidPriv) {
            const sub = typeof seller.push_subscription === "string" ? JSON.parse(seller.push_subscription) : seller.push_subscription;
            const wp = await loadWebPush();
            wp.setVapidDetails(vapidContact, vapidPub, vapidPriv);
            await wp.sendNotification(sub, JSON.stringify({
              title: status === "declined" ? "Order declined" : "Order cancelled",
              body: `${species} order #${String(order_id).slice(0, 8).toUpperCase()} has been ${status}.`,
              url: absoluteUrl(`/dashboard/orders?order=${order_id}`),
              tag: `seller-${status}-${Date.now()}`,
            }));
          }
        } catch (err) { console.warn("[seller/orders] status-change seller push failed", { order_id, err: (err as any)?.message }); }
      }
    } catch (err) { console.warn("[seller/orders] status-change email fan-out failed", { order_id, err: (err as any)?.message }); }

    return new Response(JSON.stringify({ order: data }), { status: 200 });
  } catch (err: any) {
    console.error("Seller orders error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
