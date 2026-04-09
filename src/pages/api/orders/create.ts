import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { computeDeliveryFee } from "../../../lib/order-pricing";
import { getListingOptionById } from "../../../lib/listing-pricing";

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
    let {
      listing_id,
      species,
      quantity = 1,
      quantity_unit = "piece",
      buyer_phone,
      buyer_id,
      buyer_addr,
      order_type = "pickup",
      seller_id: clientSellerId,
      scheduled_for,
      schedule_slot_id,
      pricing_option_id: clientPricingOptionId,
    } = body;

    if (!buyer_phone) {
      return new Response(JSON.stringify({ error: "Phone number required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Determine price, seller, and validate stock
    let total_price = 0;
    let seller_id: string | null = clientSellerId || null;

    let orderPricingOptionId: string | null = null;
    let orderPricingLabel: string | null = null;

    if (listing_id) {
      const { data: listing } = await supabase
        .from("fish_listings")
        .select(
          "price, price_unit, pricing_options, seller_id, weight_avail, is_available, buyer_daily_qty_limit, oos_threshold"
        )
        .eq("id", listing_id)
        .single();

      if (!listing) {
        return new Response(JSON.stringify({ error: "Listing not found" }), { status: 404 });
      }

      const chosen = getListingOptionById(listing as { price: number; price_unit: string; pricing_options?: unknown }, clientPricingOptionId);
      if (!chosen) {
        return new Response(JSON.stringify({ error: "Invalid price option for this listing" }), { status: 400 });
      }
      orderPricingOptionId = chosen.id;
      orderPricingLabel = chosen.label;
      quantity_unit = chosen.unit;

      const { data: sellerForLimits } = await supabase
        .from("sellers")
        .select("min_order_amount")
        .eq("id", listing.seller_id)
        .single();
      const minOrderAmt = Number(sellerForLimits?.min_order_amount) || 0;
      const linePrice = chosen.price;
      const minUnitsForMinOrder =
        minOrderAmt > 0 && linePrice > 0 ? Math.max(1, Math.ceil(minOrderAmt / linePrice)) : 1;

      if (listing.buyer_daily_qty_limit != null && Number(listing.buyer_daily_qty_limit) > 0) {
        const cap = Number(listing.buyer_daily_qty_limit);
        if (cap < minUnitsForMinOrder) {
          return new Response(
            JSON.stringify({
              error: `Per-buyer daily limit must be at least ${minUnitsForMinOrder} ${quantity_unit} so buyers can meet your minimum order (₹${minOrderAmt}).`,
            }),
            { status: 400 }
          );
        }
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const { data: dayOrders } = await supabase
          .from("orders")
          .select("quantity, buyer_phone, buyer_id, status")
          .eq("listing_id", listing_id)
          .gte("created_at", todayStart.toISOString());

        let usedToday = 0;
        for (const o of dayOrders || []) {
          if (o.status === "cancelled" || o.status === "declined") continue;
          const match = buyer_id
            ? o.buyer_id === buyer_id || o.buyer_phone === buyer_phone
            : o.buyer_phone === buyer_phone;
          if (match) usedToday += Number(o.quantity);
        }
        if (usedToday + quantity > cap) {
          return new Response(
            JSON.stringify({
              error: `Daily limit for this item is ${cap} ${quantity_unit} per buyer (you already have ${usedToday} today).`,
            }),
            { status: 400 }
          );
        }
      }

      // Out of stock or unavailable → pre-order. "Selling fast" / oos_threshold is buyer UI only.
      if (!listing.is_available || listing.weight_avail <= 0 || listing.weight_avail < quantity) {
        // Always allow as pre-order — no stock deduction, no blocking
        total_price = linePrice * quantity;
        seller_id = listing.seller_id;
        const amountDue = total_price;
        const { data: preOrder, error: preErr } = await supabase
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
            delivery_fee: 0,
            platform_fee: 0,
            status: "pre_order",
            order_type,
            payment_type: "cod",
            paid_amount: amountDue,
            scheduled_for: scheduled_for || null,
            schedule_slot_id: schedule_slot_id || null,
            pricing_option_id: orderPricingOptionId,
            pricing_label: orderPricingLabel,
          })
          .select()
          .single();

        if (preErr) {
          return new Response(JSON.stringify({ error: preErr.message }), { status: 500 });
        }

        // Notify seller
        if (seller_id) {
          try {
            const origin = url.origin;
            await fetch(`${origin}/api/notify-seller`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ seller_id, species: species || "Fish", quantity, quantity_unit, buyer_phone, scheduled_for: scheduled_for || null }),
            });
          } catch {}
        }

        const pre_order_reason = !listing.is_available ? "unavailable" : "out_of_stock";
        return new Response(JSON.stringify({ order: preOrder, pre_order_reason }), { status: 201 });
      }

      total_price = linePrice * quantity;
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

    // Try atomic order creation (DB function with row lock)
    // Falls back to direct insert if function not available
    let order: any = null;
    let error: any = null;

    const { data: orderId, error: rpcError } = await supabase.rpc("create_order_atomic", {
      p_listing_id: listing_id || null,
      p_species: species || null,
      p_quantity: quantity,
      p_quantity_unit: quantity_unit,
      p_buyer_phone: buyer_phone,
      p_buyer_id: buyer_id || null,
      p_buyer_addr: buyer_addr || null,
      p_total_price: total_price,
      p_delivery_fee: delivery_fee,
      p_status: status,
      p_order_type: order_type,
      p_scheduled_for: scheduled_for || null,
      p_schedule_slot_id: schedule_slot_id || null,
      p_pricing_option_id: orderPricingOptionId,
      p_pricing_label: orderPricingLabel,
    });

    if (rpcError) {
      const msg = rpcError.message || "";
      // If function doesn't exist or stock error, try direct insert as fallback
      if (msg.includes("could not find") || msg.includes("does not exist") || msg.includes("42883")) {
        // Function not created yet — use direct insert
        const { data: fallbackOrder, error: fallbackErr } = await supabase
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
            paid_amount: status === "pre_order" ? total_price + delivery_fee : null,
            scheduled_for: scheduled_for || null,
            schedule_slot_id: schedule_slot_id || null,
            pricing_option_id: orderPricingOptionId,
            pricing_label: orderPricingLabel,
          })
          .select()
          .single();
        if (fallbackErr) {
          return new Response(JSON.stringify({ error: fallbackErr.message }), { status: 500 });
        }
        order = fallbackOrder;
      } else {
        // Real stock error — surface to user
        const isStockError = msg.includes("in stock") || msg.includes("Listing not found");
        return new Response(JSON.stringify({ error: msg }), { status: isStockError ? 400 : 500 });
      }
    } else {
      // RPC succeeded — fetch the order
      const { data: fetchedOrder, error: fetchErr } = await supabase.from("orders").select().eq("id", orderId).single();
      if (fetchErr) {
        return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
      }
      order = fetchedOrder;
    }

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
