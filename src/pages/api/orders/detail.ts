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
          seller:sellers ( id, name, phone, location, location_name, opens_at, closes_at, upi_id, accepts_preorder, open_days, preorder_days, preorder_cutoff_time )
        )
      `)
      .eq("id", id)
      .single();

    if (error || !order) {
      return new Response(JSON.stringify({ error: error?.message || "Order not found" }), { status: 404 });
    }

    // The copy taken at order time wins (migration 071); older orders fall back
    // to the saved-address row, and legacy free-text addresses are shown as-is
    // (they used to hit .eq("id", text), error out, and show no address at all).
    let address: any = (order as any).delivery_address || null;
    if (!address && order.buyer_addr) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(order.buyer_addr)) {
        const { data: addr } = await sb
          .from("buyer_addresses")
          .select("id, label, flat, building, landmark, location_name, lat, lng")
          .eq("id", order.buyer_addr)
          .maybeSingle();
        address = addr;
      } else {
        address = { location_name: order.buyer_addr };
      }
    }
    // Authorization: buyer must own this order (matches buyer_id OR phone).
    //
    // BUG-39: this used to read `if (order.buyer_id && order.buyer_id !== buyer_id)`.
    // For a guest order `buyer_id` is NULL (orders/create inserts
    // `buyer_id: buyer_id || null`), so the && short-circuited and NO
    // authorization ran at all — anyone holding the order UUID got the full
    // select("*"): buyer_phone, buyer_notes, the delivery address, seller phone,
    // and upi_id when Razorpay is off. Verified against staging: an unrelated
    // buyer_id read a guest order's phone and notes over HTTP 200.
    //
    // Now a NULL buyer_id falls through to the phone comparison, which is what
    // the sibling endpoints (update-notes, payment-screenshots) already do.
    if (order.buyer_id !== buyer_id) {
      const { data: buyer } = await sb.from("buyers").select("phone").eq("id", buyer_id).single();
      if (!buyer || !order.buyer_phone || buyer.phone !== order.buyer_phone) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
      }
    }

    const rawSeller = order.listing?.seller || null;
    // Strip UPI ID from response when Razorpay is enabled — prevents client-side leak
    // Razorpay is the only payment method: never send the seller's UPI id.
    const seller = rawSeller ? { ...rawSeller, upi_id: undefined } : null;

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
