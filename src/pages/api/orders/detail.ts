import type { APIRoute } from "astro";
import { requireBuyer } from "../../../lib/server/session";
import { createClient } from "@supabase/supabase-js";
import { pickPayableCartRows, rowPaise } from "../../../lib/server/order-cart";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * GET /api/orders/detail?id=<order_id>&buyer_id=<id>
 * Returns full order detail (order + listing + seller + address) for the buyer who owns it.
 * 403 if buyer doesn't own the order, 404 if not found.
 */
export const GET: APIRoute = async ({ url, request }) => {
  try {
    const id = url.searchParams.get("id");
    const buyer_id = url.searchParams.get("buyer_id");
    { const denied = requireBuyer(request, buyer_id); if (denied) return denied; }
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

    // The whole checkout this order belongs to: every item with its own status and
    // refund, and what one Pay press charges now (all items still awaiting payment).
    let cart: any = null;
    if ((order as any).cart_id) {
      const { data: items } = await sb
        .from("orders")
        .select("id, cart_id, buyer_id, species, quantity, quantity_unit, pricing_label, total_price, delivery_fee, status, created_at, cancelled_by, cancel_reason, refund_amt, refund_sent_at, razorpay_order_id, razorpay_payment_id, payment_method, final_price, listing:fish_listings(species)")
        .eq("cart_id", (order as any).cart_id)
        .eq("buyer_id", (order as any).buyer_id)
        .order("created_at", { ascending: true });
      if (items && items.length > 1) {
        const payable = pickPayableCartRows(order as any, items as any[]);
        cart = {
          id: (order as any).cart_id,
          items: items.map((i: any) => ({
            id: i.id, species: i.listing?.species || i.species, quantity: i.quantity, quantity_unit: i.quantity_unit,
            pricing_label: i.pricing_label, total_price: i.total_price, delivery_fee: i.delivery_fee, status: i.status,
            cancelled_by: i.cancelled_by, cancel_reason: i.cancel_reason, refund_amt: i.refund_amt, refund_sent_at: i.refund_sent_at,
            final_price: i.final_price, paid: !!i.razorpay_payment_id,
          })),
          payable_ids: payable.map((r: any) => r.id),
          payable_total: payable.reduce((sum: number, r: any) => sum + rowPaise(r), 0) / 100,
        };
      }
    }

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
          cart,
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
