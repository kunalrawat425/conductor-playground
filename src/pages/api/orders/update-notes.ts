import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * POST /api/orders/update-notes
 * Body: { order_id, buyer_id, cut_style, buyer_notes }
 * Buyer updates their preferences on a confirmed order.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { order_id, buyer_id, cut_style, buyer_notes } = await request.json();
    if (!order_id || !buyer_id) {
      return new Response(JSON.stringify({ error: "order_id and buyer_id required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify buyer owns this order
    const { data: order } = await supabase
      .from("orders")
      .select("id, buyer_id, buyer_phone")
      .eq("id", order_id)
      .single();

    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
    }

    if (order.buyer_id !== buyer_id) {
      const { data: buyer } = await supabase.from("buyers").select("phone").eq("id", buyer_id).single();
      if (!buyer || buyer.phone !== order.buyer_phone) {
        return new Response(JSON.stringify({ error: "Not your order" }), { status: 403 });
      }
    }

    const { error } = await supabase
      .from("orders")
      .update({
        cut_style: typeof cut_style === "string" ? cut_style.slice(0, 100) : "",
        buyer_notes: typeof buyer_notes === "string" ? buyer_notes.slice(0, 500) : "",
      })
      .eq("id", order_id);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
