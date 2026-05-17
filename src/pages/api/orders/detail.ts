import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * GET /api/orders/detail?id=<order_id>&buyer_id=<id>
 * Returns full order detail (order + listing + seller + address) for the buyer who owns it.
 * 403 if buyer doesn't own the order, 404 if not found.
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const id = url.searchParams.get("id");
    const buyer_id = url.searchParams.get("buyer_id");
    if (!id || !buyer_id) {
      return new Response(JSON.stringify({ error: "id and buyer_id required" }), { status: 400 });
    }

    const sb = createClient(supabaseUrl, supabaseServiceKey);

    const { data: order, error } = await sb
      .from("orders")
      .select(`
        *,
        listing:fish_listings ( id, species, photo_url, pricing_options, is_preorder_enabled,
          seller:sellers ( id, name, phone, location, location_name, opens_at, closes_at, upi_id )
        )
      `)
      .eq("id", id)
      .single();

    if (error || !order) {
      return new Response(JSON.stringify({ error: error?.message || "Order not found" }), { status: 404 });
    }

    // Fetch address separately if order had one
    let address = null;
    if (order.buyer_addr) {
      const { data: addr } = await sb
        .from("buyer_addresses")
        .select("id, label, flat, building, landmark, location_name, lat, lng")
        .eq("id", order.buyer_addr)
        .single();
      address = addr;
    }
    // Authorization: buyer must own this order (matches buyer_id OR phone)
    if (order.buyer_id && order.buyer_id !== buyer_id) {
      // Allow phone-based access if buyer_id wasn't recorded at order time
      const { data: buyer } = await sb.from("buyers").select("phone").eq("id", buyer_id).single();
      if (!buyer || buyer.phone !== order.buyer_phone) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
      }
    }

    const rawSeller = order.listing?.seller || null;
    // Strip UPI ID from response when Razorpay is enabled — prevents client-side leak
    const razorpayEnabled = import.meta.env.PUBLIC_ENABLE_RAZORPAY === "true";
    const seller = rawSeller
      ? { ...rawSeller, upi_id: razorpayEnabled ? undefined : (rawSeller as any).upi_id }
      : null;

    const { data: feedback } = await sb
      .from("order_feedback")
      .select("rating, feedback, created_at, updated_at")
      .eq("order_id", id)
      .eq("buyer_id", buyer_id)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        order: {
          ...order,
          buyer_feedback: feedback || null,
          seller,
          address,
          listing: order.listing
            ? {
                species: order.listing.species,
                photo_url: order.listing.photo_url,
                is_preorder_enabled: (order.listing as any).is_preorder_enabled === true,
                pricing_options: (order.listing as any).pricing_options || [],
                seller_id: (order.listing as any).seller?.id || null,
              }
            : null,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
