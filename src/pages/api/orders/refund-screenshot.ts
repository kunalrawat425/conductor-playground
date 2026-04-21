import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * GET /api/orders/refund-screenshot?order_id=&buyer_id=
 * Buyer-accessible signed URL for seller's refund proof screenshot (1h expiry).
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const order_id = url.searchParams.get("order_id");
    const buyer_id = url.searchParams.get("buyer_id");

    if (!order_id || !buyer_id) {
      return new Response(JSON.stringify({ error: "order_id and buyer_id required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: order } = await supabase
      .from("orders")
      .select("buyer_id, buyer_phone, refund_screenshot_path")
      .eq("id", order_id)
      .single();

    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
    }

    // Verify buyer owns this order
    if (order.buyer_id !== buyer_id) {
      const { data: buyer } = await supabase.from("buyers").select("phone").eq("id", buyer_id).single();
      if (!buyer || buyer.phone !== order.buyer_phone) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
      }
    }

    if (!order.refund_screenshot_path) {
      return new Response(JSON.stringify({ error: "No refund screenshot on this order" }), { status: 404 });
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from("order-payments")
      .createSignedUrl(order.refund_screenshot_path, 3600);

    if (signErr || !signed?.signedUrl) {
      return new Response(JSON.stringify({ error: signErr?.message || "Could not generate URL" }), { status: 500 });
    }

    return new Response(JSON.stringify({ url: signed.signedUrl }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
