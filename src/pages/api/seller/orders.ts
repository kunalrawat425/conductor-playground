import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { sendBuyerOrderPush } from "../../../lib/server/buyer-push";
import { orderEmailBuyer, orderEmailSeller } from "../../../lib/email-templates";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

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

async function sendResendEmail(to: string, subject: string, bodyHtml: string) {
  if (!resendApiKey || !to || !to.includes("@")) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Relifish <noreply@relifish.store>", to, subject, html: bodyHtml }),
    });
  } catch (_) {}
}

/**
 * POST /api/seller/orders
 * Body: { seller_id, order_id, status?, action?, final_price? }
 * action=set_final_price: calls reconcile_preorder_price RPC, returns new status
 * action=verify_payment: marks payment verified by seller
 * Otherwise: status transition with optional final_price
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { seller_id, order_id, status, action, final_price, refund_note } = await request.json();

    if (!seller_id || !order_id) {
      return new Response(JSON.stringify({ error: "seller_id and order_id required" }), { status: 400 });
    }
    if (!action && !status) {
      return new Response(JSON.stringify({ error: "action or status required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify order belongs to this seller's listings
    const { data: order } = await supabase
      .from("orders")
      .select("listing_id, buyer_id, species, seller_id")
      .eq("id", order_id)
      .single();

    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
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
    } else if (order.seller_id && order.seller_id !== seller_id) {
      // Direct seller orders (no listing) — check seller_id on the order itself
      return new Response(JSON.stringify({ error: "Not your order" }), { status: 403 });
    } else if (!order.listing_id && !order.seller_id) {
      // Orphan order with no ownership anchor — deny
      return new Response(JSON.stringify({ error: "Order ownership cannot be verified" }), { status: 403 });
    }

    // action=set_final_price: use reconcile_preorder_price RPC
    if (action === "set_final_price") {
      if (final_price === undefined || final_price === null) {
        return new Response(JSON.stringify({ error: "final_price required for set_final_price" }), { status: 400 });
      }
      const { data: newStatus, error: rpcErr } = await supabase.rpc("reconcile_preorder_price", {
        p_order_id: order_id,
        p_final_price: final_price,
      });
      if (rpcErr) {
        return new Response(JSON.stringify({ error: rpcErr.message }), { status: 500 });
      }
      const { data, error: fetchErr } = await supabase.from("orders").select().eq("id", order_id).single();
      if (fetchErr) {
        return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
      }
      // Notify buyer
      if (order.buyer_id) {
        try {
          await sendBuyerOrderPush({ buyer_id: order.buyer_id, status: newStatus, species: order.species || "Fish", final_price });
        } catch (_) {}
      }
      return new Response(JSON.stringify({ order: data, reconciled_status: newStatus }), { status: 200 });
    }

    // action=mark_refund_sent: seller confirms UPI refund was sent to buyer
    if (action === "mark_refund_sent") {
      const { data, error: rErr } = await supabase
        .from("orders")
        .update({
          refund_sent_at: new Date().toISOString(),
          refund_note: refund_note || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order_id)
        .select()
        .single();
      if (rErr) {
        return new Response(JSON.stringify({ error: rErr.message }), { status: 500 });
      }
      if (order.buyer_id) {
        try {
          await sendBuyerOrderPush({ buyer_id: order.buyer_id, status: "refunded", species: order.species || "Fish", final_price: null });
        } catch (_) {}
      }
      return new Response(JSON.stringify({ order: data }), { status: 200 });
    }

    // action=verify_payment: mark payment verified and advance pending_payment → confirmed
    if (action === "verify_payment") {
      const { data: currentForVerify } = await supabase.from("orders").select("status").eq("id", order_id).single();
      const verifyUpdates: any = {
        payment_verified_at: new Date().toISOString(),
        payment_verified_by: seller_id,
        updated_at: new Date().toISOString(),
      };
      if (currentForVerify?.status === "pending_payment") {
        verifyUpdates.status = "confirmed";
      }
      const { data, error: vErr } = await supabase
        .from("orders")
        .update(verifyUpdates)
        .eq("id", order_id)
        .select()
        .single();
      if (vErr) {
        return new Response(JSON.stringify({ error: vErr.message }), { status: 500 });
      }
      // Notify buyer if status advanced
      if (verifyUpdates.status === "confirmed" && order.buyer_id) {
        try {
          await sendBuyerOrderPush({ buyer_id: order.buyer_id, status: "confirmed", species: order.species || "Fish", final_price: null });
        } catch (_) {}
      }
      return new Response(JSON.stringify({ order: data }), { status: 200 });
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
      ready_for_pickup: ["completed", "cancelled"],
      out_for_delivery: ["completed", "cancelled"],
    };
    const { data: currentOrder } = await supabase.from("orders").select("status").eq("id", order_id).single();
    const currentStatus = currentOrder?.status;
    if (currentStatus && validTransitions[currentStatus] && !validTransitions[currentStatus].includes(status)) {
      return new Response(JSON.stringify({ error: `Cannot change from ${currentStatus} to ${status}` }), { status: 400 });
    }

    const updates: any = { status };
    if (final_price !== undefined) {
      updates.final_price = final_price;
    }
    if (status === "declined" || status === "cancelled") {
      updates.cancelled_by = "seller";
    }

    const { data, error } = await supabase
      .from("orders")
      .update(updates)
      .eq("id", order_id)
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    // Notify buyer via push — never fail the order update if push throws
    if (order.buyer_id) {
      try {
        const pushResult = await sendBuyerOrderPush({
          buyer_id: order.buyer_id,
          status,
          species: order.species || "Fish",
          final_price: final_price ?? null,
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
      const species = order.species || "Fish";
      const totalAmount = final_price ? Number(final_price) : Number(data.total_price) || 0;
      const emailArgs = {
        statusLabel,
        species,
        quantity: data.quantity || 0,
        quantity_unit: data.quantity_unit || "piece",
        totalAmount: totalAmount + (Number(data.delivery_fee) || 0),
        deliveryFee: Number(data.delivery_fee) || 0,
        orderId: order_id,
        scheduled_for: data.scheduled_for || null,
        buyerNotes: data.buyer_notes || null,
        cutStyle: data.cut_style || null,
      };

      // Email buyer (if they have email)
      if (order.buyer_id) {
        const { data: buyer } = await supabase.from("buyers").select("email").eq("id", order.buyer_id).single();
        if (buyer?.email) {
          await sendResendEmail(buyer.email, `${statusLabel} — ${species}`, orderEmailBuyer(emailArgs));
        }
      }

      // Email seller
      const { data: seller } = await supabase.from("sellers").select("email").eq("id", seller_id).single();
      if (seller?.email) {
        await sendResendEmail(seller.email, `Order Update: ${statusLabel} — ${species}`, orderEmailSeller(emailArgs));
      }
    } catch (_) {}

    return new Response(JSON.stringify({ order: data }), { status: 200 });
  } catch (err: any) {
    console.error("Seller orders error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
