import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { computeDeliveryFee } from "../../../lib/order-pricing";

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

type LineInput = { listing_id?: string; quantity?: number };

function mergeOrderLines(raw: LineInput[]): { listing_id: string; quantity: number }[] {
  const m = new Map<string, number>();
  for (const row of raw) {
    const id = row.listing_id;
    const q = Number(row.quantity);
    if (!id || !Number.isFinite(q) || q <= 0) continue;
    m.set(id, (m.get(id) || 0) + q);
  }
  return [...m.entries()].map(([listing_id, quantity]) => ({ listing_id, quantity }));
}

const sellerSelect =
  "opens_at, closes_at, accepts_preorder, has_delivery, min_order_amount, delivery_fee_enabled, delivery_fee_amount, free_delivery_above, is_active";

/**
 * POST /api/orders/create
 * Body (single line): { listing_id, species, quantity, quantity_unit, buyer_phone, buyer_id?, buyer_addr?, order_type, seller_id? }
 * Body (cart): { lines: [{ listing_id, quantity }], buyer_phone, ... } — min order & delivery fee use combined subtotal; one DB row per line.
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
      lines: rawLines,
    } = body;

    if (!buyer_phone) {
      return new Response(JSON.stringify({ error: "Phone number required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (buyer_id) {
      const { data: buyerRow } = await supabase.from("buyers").select("is_active").eq("id", buyer_id).maybeSingle();
      if (buyerRow && buyerRow.is_active === false) {
        return new Response(
          JSON.stringify({ error: "Your account cannot place orders right now." }),
          { status: 403 }
        );
      }
    }

    // Multi-line cart from seller menu: one request, min order applies to sum of lines
    if (rawLines && Array.isArray(rawLines) && rawLines.length > 0) {
      const merged = mergeOrderLines(rawLines as LineInput[]);
      if (merged.length === 0) {
        return new Response(JSON.stringify({ error: "No valid line items" }), { status: 400 });
      }

      const listingIds = [...new Set(merged.map((x) => x.listing_id))];
      const { data: listings, error: listingsError } = await supabase
        .from("fish_listings")
        .select("id, price, price_unit, seller_id, weight_avail, is_available, species")
        .in("id", listingIds);

      if (listingsError || !listings || listings.length !== listingIds.length) {
        return new Response(JSON.stringify({ error: "One or more listings not found" }), { status: 404 });
      }

      const byId = new Map(listings.map((l) => [l.id as string, l]));
      const seller_id = listings[0].seller_id as string;
      for (const l of listings) {
        if (l.seller_id !== seller_id) {
          return new Response(
            JSON.stringify({ error: "All items in one order must be from the same seller" }),
            { status: 400 }
          );
        }
      }
      if (clientSellerId && clientSellerId !== seller_id) {
        return new Response(JSON.stringify({ error: "Seller mismatch" }), { status: 400 });
      }

      let cartSubtotal = 0;
      const resolved: { listing: (typeof listings)[0]; quantity: number; lineTotal: number }[] = [];
      for (const row of merged) {
        const listing = byId.get(row.listing_id);
        if (!listing) {
          return new Response(JSON.stringify({ error: "Listing not found" }), { status: 404 });
        }
        if (!listing.is_available) {
          return new Response(JSON.stringify({ error: "This item is no longer available" }), { status: 400 });
        }
        if (Number(listing.weight_avail) < row.quantity) {
          return new Response(
            JSON.stringify({
              error: `Only ${listing.weight_avail} ${listing.price_unit} in stock for one of your items`,
            }),
            { status: 400 }
          );
        }
        const lineTotal = Number(listing.price) * row.quantity;
        cartSubtotal += lineTotal;
        resolved.push({ listing, quantity: row.quantity, lineTotal });
      }

      const { data: seller } = await supabase.from("sellers").select(sellerSelect).eq("id", seller_id).single();

      if (seller && (seller as { is_active?: boolean }).is_active === false) {
        return new Response(JSON.stringify({ error: "This seller is not accepting orders." }), { status: 400 });
      }

      let status = "pending";
      if (seller && !isSellerCurrentlyOpen(seller.opens_at, seller.closes_at)) {
        if (seller.accepts_preorder === false) {
          return new Response(
            JSON.stringify({ error: "This seller is closed and does not accept pre-orders" }),
            { status: 400 }
          );
        }
        status = "pre_order";
      }

      const minAmt = Number(seller?.min_order_amount) || 0;
      if (minAmt > 0 && cartSubtotal < minAmt) {
        return new Response(
          JSON.stringify({ error: `Minimum order for this seller is ₹${minAmt}` }),
          { status: 400 }
        );
      }

      if (order_type === "delivery" && !seller?.has_delivery) {
        return new Response(JSON.stringify({ error: "This seller does not offer delivery" }), { status: 400 });
      }

      const deliveryFeeTotal = seller ? computeDeliveryFee(seller, cartSubtotal, order_type) : 0;
      const origin = url.origin;
      const ordersOut: unknown[] = [];

      for (let i = 0; i < resolved.length; i++) {
        const { listing, quantity: qty, lineTotal } = resolved[i];
        const lineDelivery = i === 0 ? deliveryFeeTotal : 0;
        const amountDueLine = lineTotal + lineDelivery;

        const { data: order, error } = await supabase
          .from("orders")
          .insert({
            listing_id: listing.id,
            species: listing.species,
            buyer_phone,
            buyer_id: buyer_id || null,
            buyer_addr: buyer_addr || null,
            quantity: qty,
            quantity_unit: listing.price_unit,
            total_price: lineTotal,
            delivery_fee: lineDelivery,
            platform_fee: 0,
            status,
            order_type,
            payment_type: "cod",
            paid_amount: status === "pre_order" ? amountDueLine : null,
          })
          .select()
          .single();

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }
        if (order) ordersOut.push(order);

        try {
          await fetch(`${origin}/api/notify-seller`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              seller_id,
              species: listing.species || "Fish",
              quantity: qty,
              quantity_unit: listing.price_unit,
              buyer_phone,
            }),
          });
        } catch {
          // non-blocking
        }
      }

      return new Response(JSON.stringify({ orders: ordersOut }), { status: 201 });
    }

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

    // Determine pre-order status, min order, delivery fee
    let status = "pending";
    let delivery_fee = 0;
    if (seller_id) {
      const { data: seller } = await supabase.from("sellers").select(sellerSelect).eq("id", seller_id).single();

      if (seller && (seller as { is_active?: boolean }).is_active === false) {
        return new Response(JSON.stringify({ error: "This seller is not accepting orders." }), { status: 400 });
      }

      if (seller && !isSellerCurrentlyOpen(seller.opens_at, seller.closes_at)) {
        if (seller.accepts_preorder === false) {
          return new Response(
            JSON.stringify({ error: "This seller is closed and does not accept pre-orders" }),
            { status: 400 }
          );
        }
        status = "pre_order";
      }

      const minAmt = Number(seller?.min_order_amount) || 0;
      if (minAmt > 0 && total_price < minAmt) {
        return new Response(
          JSON.stringify({ error: `Minimum order for this seller is ₹${minAmt}` }),
          { status: 400 }
        );
      }

      if (order_type === "delivery" && !seller?.has_delivery) {
        return new Response(JSON.stringify({ error: "This seller does not offer delivery" }), { status: 400 });
      }

      delivery_fee = seller ? computeDeliveryFee(seller, total_price, order_type) : 0;
    }

    const amountDue = total_price + delivery_fee;

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
        delivery_fee,
        platform_fee: 0,
        status,
        order_type,
        payment_type: "cod",
        paid_amount: status === "pre_order" ? amountDue : null,
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
