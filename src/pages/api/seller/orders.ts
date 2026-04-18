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
  confirmed: "Order Confirmed",
  paid: "Payment Received",
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
 * Body: { seller_id, order_id, status, final_price? }
 * Uses service_role key to bypass RLS
 * Notifies buyer via push when status changes
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { seller_id, order_id, status, final_price } = await request.json();

    if (!seller_id || !order_id || !status) {
      return new Response(JSON.stringify({ error: "seller_id, order_id, and status required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify order belongs to this seller's listings
    const { data: order } = await supabase
      .from("orders")
      .select("listing_id, buyer_id, species")
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
    }

    // Validate status transition
    const validTransitions: Record<string, string[]> = {
      pending: ["confirmed", "declined"],
      pre_order: ["confirmed", "declined"],
      scheduled: ["confirmed", "declined"],
      confirmed: ["ready_for_pickup", "out_for_delivery", "declined", "cancelled"],
      paid: ["ready_for_pickup", "out_for_delivery", "declined", "cancelled"],
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
      // When seller sets final_price on a pre-order, keep as pre_order
      // Buyer must accept before it becomes confirmed
      if (status === "confirmed") {
        if (currentStatus === "pre_order") {
          updates.status = "pre_order"; // Stay as pre_order until buyer accepts
        }
      }
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
