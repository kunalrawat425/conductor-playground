import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { order_id, buyer_id, action, cancel_reason } = await request.json();
    if (!order_id || !buyer_id) {
      return new Response(JSON.stringify({ error: "order_id and buyer_id required" }), { status: 400 });
    }

    const sb = createClient(supabaseUrl, supabaseServiceKey);

    const { data: order } = await sb.from("orders").select("*").eq("id", order_id).eq("buyer_id", buyer_id).single();
    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
    }

    // Cancel: only allowed for pending, pre_order, scheduled
    if (action === "cancel") {
      if (!["pending", "pre_order", "scheduled"].includes(order.status)) {
        return new Response(JSON.stringify({ error: "Cannot cancel — order is already " + order.status }), { status: 400 });
      }

      // Restore stock if listing exists
      if (order.listing_id) {
        await sb.rpc("restore_order_stock", { p_listing_id: order.listing_id, p_quantity: order.quantity });
      }

      await sb.from("orders").update({ status: "cancelled", cancelled_by: "buyer", cancel_reason: cancel_reason || null }).eq("id", order_id);

      return new Response(JSON.stringify({ success: true, status: "cancelled" }), { status: 200 });
    }

    // Accept pre-order final price
    if (action === "accept_price") {
      if (order.status !== "confirmed" || !order.final_price) {
        return new Response(JSON.stringify({ error: "No price to accept" }), { status: 400 });
      }
      // Already confirmed by seller, buyer accepts — no status change needed
      return new Response(JSON.stringify({ success: true, status: "confirmed" }), { status: 200 });
    }

    // Reject pre-order final price
    if (action === "reject_price") {
      if (!order.final_price) {
        return new Response(JSON.stringify({ error: "No price to reject" }), { status: 400 });
      }

      if (order.listing_id) {
        await sb.rpc("restore_order_stock", { p_listing_id: order.listing_id, p_quantity: order.quantity });
      }

      await sb.from("orders").update({ status: "cancelled", refund_amt: order.paid_amount, cancelled_by: "buyer", cancel_reason: "Price rejected by buyer" }).eq("id", order_id);

      return new Response(JSON.stringify({ success: true, status: "cancelled" }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
