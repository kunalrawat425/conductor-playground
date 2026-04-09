import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { computeDeliveryFee } from "../../../lib/order-pricing";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

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
      scheduled_for,
      schedule_slot_id,
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

    // Determine order status: scheduled > pre_order > pending
    let status = "pending";
    let delivery_fee = 0;
    if (scheduled_for) {
      status = "scheduled";
    }
    if (seller_id) {
      const { data: seller } = await supabase
        .from("sellers")
        .select(
          "opens_at, closes_at, accepts_preorder, has_delivery, min_order_amount, delivery_fee_enabled, delivery_fee_amount, free_delivery_above"
        )
        .eq("id", seller_id)
        .single();

      if (!scheduled_for && seller && !isSellerCurrentlyOpen(seller.opens_at, seller.closes_at)) {
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
        scheduled_for: scheduled_for || null,
        schedule_slot_id: schedule_slot_id || null,
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
            scheduled_for: scheduled_for || null,
          }),
        });
      } catch {
        // Non-blocking — order still created even if notification fails
      }
    }

    // Send email on order creation
    if (resendApiKey && order) {
      try {
        const statusLabel = status === "scheduled" ? "Order Scheduled 🗓️" : status === "pre_order" ? "Pre-order Placed" : "Order Placed";
        const schedText = scheduled_for ? `<p style="color:#1565c0;font-weight:600;">🗓️ Scheduled: ${new Date(scheduled_for).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} at ${new Date(scheduled_for).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>` : "";
        const emailBody = `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
            <h1 style="font-size:20px;margin:0 0 12px;">🐟 ${statusLabel}</h1>
            <div style="background:#f8f9fa;border-radius:12px;padding:16px;margin:0 0 16px;">
              <p style="margin:0 0 8px;font-size:15px;"><strong>${species || "Fish"}</strong> · ${quantity} ${quantity_unit}</p>
              <p style="margin:0 0 8px;font-size:15px;font-weight:600;">₹${total_price + delivery_fee}</p>
              ${schedText}
            </div>
            <a href="https://www.relifish.store/track" style="display:inline-block;background:#0066cc;color:white;padding:10px 24px;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px;">Track Order</a>
            <p style="font-size:12px;color:#999;margin:16px 0 0;">— Team Relifish</p>
          </div>
        `;
        // Email buyer
        if (buyer_id) {
          const { data: buyer } = await supabase.from("buyers").select("email").eq("id", buyer_id).single();
          if (buyer?.email) {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ from: "Relifish <onboarding@resend.dev>", to: buyer.email, subject: `${statusLabel} — ${species || "Fish"}`, html: emailBody }),
            });
          }
        }
        // Email seller
        if (seller_id) {
          const { data: sellerData } = await supabase.from("sellers").select("email").eq("id", seller_id).single();
          if (sellerData?.email) {
            const sellerEmail = emailBody.replace("Track Order", "View Orders").replace("/track", "/dashboard/orders");
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ from: "Relifish <onboarding@resend.dev>", to: sellerData.email, subject: `New Order: ${species || "Fish"} — ${buyer_phone}`, html: sellerEmail }),
            });
          }
        }
      } catch (_) {}
    }

    return new Response(JSON.stringify({ order }), { status: 201 });
  } catch (err: any) {
    console.error("Order create error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
