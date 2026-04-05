import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * POST /api/seller/orders
 * Body: { seller_id, order_id, status, final_price? }
 * Uses service_role key to bypass RLS
 * Notifies buyer via push when status changes
 */
export const POST: APIRoute = async ({ request, url }) => {
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

    const updates: any = { status };
    if (final_price !== undefined) {
      updates.final_price = final_price;
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

    // Notify buyer via push notification
    if (order.buyer_id) {
      try {
        const origin = url.origin;
        await fetch(`${origin}/api/push-notify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            buyer_id: order.buyer_id,
            status,
            species: order.species || "Fish",
            final_price: final_price || null,
          }),
        });
      } catch {
        // Non-blocking — order update still succeeds even if notification fails
      }
    }

    return new Response(JSON.stringify({ order: data }), { status: 200 });
  } catch (err: any) {
    console.error("Seller orders error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
