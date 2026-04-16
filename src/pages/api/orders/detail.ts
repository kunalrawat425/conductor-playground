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
        listing:fish_listings ( id, species, photo_url, pricing_options,
          seller:sellers ( id, name, phone, location, location_name, opens_at, closes_at )
        ),
        address:buyer_addresses ( id, label, flat, building, landmark, location_name, lat, lng )
      `)
      .eq("id", id)
      .single();

    if (error || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
    }
    // Authorization: buyer must own this order (matches buyer_id OR phone)
    if (order.buyer_id && order.buyer_id !== buyer_id) {
      // Allow phone-based access if buyer_id wasn't recorded at order time
      const { data: buyer } = await sb.from("buyers").select("phone").eq("id", buyer_id).single();
      if (!buyer || buyer.phone !== order.buyer_phone) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
      }
    }

    const seller = order.listing?.seller || null;

    return new Response(
      JSON.stringify({
        order: {
          ...order,
          seller,
          listing: order.listing ? { species: order.listing.species, photo_url: order.listing.photo_url } : null,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
