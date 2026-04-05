import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

function isSellerCurrentlyOpen(opensAt: string | null, closesAt: string | null): boolean {
  if (!opensAt || !closesAt) return true;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = opensAt.split(":").map(Number);
  const [ch, cm] = closesAt.split(":").map(Number);
  const open = oh * 60 + (om || 0);
  const close = ch * 60 + (cm || 0);
  if (close > open) return current >= open && current < close;
  return current >= open || current < close;
}

/**
 * POST /api/orders/create
 * Body: { listing_id, species, quantity, quantity_unit, buyer_phone, buyer_id?, buyer_addr?, order_type, seller_id? }
 * - Validates stock before accepting
 * - Checks seller accepts_preorder if seller is closed
 * - Inventory decrement handled by DB trigger (006_preorder_and_inventory.sql)
 */
export const POST: APIRoute = async ({ request, url }) => {
  try {
    const body = await request.json();
    const {
      listing_id,
      species,
      quantity = 1,
      quantity_unit = "kg",
      buyer_phone,
      buyer_id,
      buyer_addr,
      order_type = "pickup",
      seller_id: clientSellerId,
    } = body;

    if (!buyer_phone) {
      return new Response(JSON.stringify({ error: "Phone number required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Determine price, seller, and validate stock
    let total_price = 0;
    let seller_id: string | null = clientSellerId || null;

    if (listing_id) {
      const { data: listing } = await supabase
        .from("fish_listings")
        .select("price, price_unit, seller_id, weight_avail, is_available")
        .eq("id", listing_id)
        .single();

      if (!listing) {
        return new Response(JSON.stringify({ error: "Listing not found" }), { status: 404 });
      }

      if (!listing.is_available) {
        return new Response(JSON.stringify({ error: "This item is no longer available" }), { status: 400 });
      }

      if (listing.weight_avail < quantity) {
        return new Response(
          JSON.stringify({ error: `Only ${listing.weight_avail} ${listing.price_unit} in stock` }),
          { status: 400 }
        );
      }

      total_price = listing.price * quantity;
      seller_id = listing.seller_id;
    } else if (species) {
      const { data: range } = await supabase
        .from("species_ranges")
        .select("max_price")
        .eq("species", species)
        .single();

      total_price = (range?.max_price || 0) * quantity;
    }

    // Determine pre-order status based on seller operating hours + accepts_preorder
    let status = "pending";
    if (seller_id) {
      const { data: seller } = await supabase
        .from("sellers")
        .select("opens_at, closes_at, accepts_preorder")
        .eq("id", seller_id)
        .single();

      if (seller && !isSellerCurrentlyOpen(seller.opens_at, seller.closes_at)) {
        if (seller.accepts_preorder === false) {
          return new Response(
            JSON.stringify({ error: "This seller is closed and does not accept pre-orders" }),
            { status: 400 }
          );
        }
        status = "pre_order";
      }
    }

    // Insert order (inventory decrement handled by DB trigger)
    const { data: order, error } = await supabase
      .from("orders")
      .insert({
        listing_id: listing_id || null,
        species: species || null,
        buyer_phone,
        buyer_id: buyer_id || null,
        buyer_addr: buyer_addr || null,
        quantity,
        quantity_unit,
        total_price,
        platform_fee: 0,
        status,
        order_type,
        payment_type: "cod",
        paid_amount: status === "pre_order" ? total_price : null,
      })
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    // Notify seller via push notification
    if (seller_id) {
      try {
        const origin = url.origin;
        await fetch(`${origin}/api/notify-seller`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            seller_id,
            species: species || "Fish",
            quantity,
            quantity_unit,
            buyer_phone,
          }),
        });
      } catch {
        // Non-blocking — order still created even if notification fails
      }
    }

    return new Response(JSON.stringify({ order }), { status: 201 });
  } catch (err: any) {
    console.error("Order create error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
