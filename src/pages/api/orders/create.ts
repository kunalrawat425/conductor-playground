import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { computeDeliveryFee } from "../../../lib/order-pricing";
import { orderEmailBuyer, orderEmailSeller } from "../../../lib/email-templates";
import {
  getListingOptionById,
  getListingPriceOptions,
  optionBundleAmount,
  isPerBaseUnitPricing,
  minimumRequiredBuyerDailyCap,
  type ListingPricingSource,
} from "../../../lib/listing-pricing";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

function isSellerCurrentlyOpen(opensAt: string | null, closesAt: string | null): boolean {
  if (!opensAt || !closesAt) return true;
  // Use IST (UTC+5:30) — Vercel servers run UTC
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  const current = now.getUTCHours() * 60 + now.getUTCMinutes();
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
      quantity: rawQuantity = 1,
      quantity_unit = "piece",
      buyer_phone,
      buyer_id,
      buyer_addr,
      order_type = "pickup",
      seller_id: clientSellerId,
      scheduled_for,
      schedule_slot_id,
      pricing_option_id: clientPricingOptionId,
      buyer_notes,
      cut_style,
    } = body;

    let quantity = typeof rawQuantity === "number" ? rawQuantity : parseFloat(String(rawQuantity));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return new Response(JSON.stringify({ error: "Invalid quantity" }), { status: 400 });
    }

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
        .select("pricing_options, seller_id, weight_avail, is_available, buyer_daily_qty_limit, oos_threshold, is_preorder_enabled")
        .eq("id", listing_id)
        .single();

      if (!listing) {
        return new Response(JSON.stringify({ error: "Listing not found" }), { status: 404 });
      }

      const chosen = getListingOptionById(
        listing as ListingPricingSource,
        clientPricingOptionId
      );
      if (!chosen) {
        return new Response(JSON.stringify({ error: "Invalid price option for this listing" }), { status: 400 });
      }
      orderPricingOptionId = chosen.id;
      orderPricingLabel = chosen.label;
      quantity_unit = chosen.unit;

      // Whole units for piece; 2 decimals for kg — matches inventory decrement in create_order_atomic
      if (quantity_unit === "kg") {
        quantity = Math.round(Number(quantity) * 100) / 100;
      } else {
        quantity = Math.floor(Number(quantity));
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return new Response(JSON.stringify({ error: "Invalid quantity" }), { status: 400 });
      }

      const linePrice = chosen.price;
      const bundleAmount = optionBundleAmount(chosen);
      const perBase = isPerBaseUnitPricing(chosen);

      // Skip bundle validation for pre-orders (OOS / unavailable listings)
      const weightAvailCheck = Number(listing.weight_avail);
      const isPreorderCandidate = !listing.is_available || !Number.isFinite(weightAvailCheck) || weightAvailCheck <= 0 || weightAvailCheck < quantity;

      if (!perBase && !isPreorderCandidate) {
        if (quantity_unit === "kg") {
          const qCent = Math.round(quantity * 100);
          const bCent = Math.round(bundleAmount * 100);
          if (bCent < 1 || qCent % bCent !== 0) {
            return new Response(
              JSON.stringify({
                error: `Quantity must be a multiple of ${bundleAmount} kg for this price line (e.g. ${bundleAmount}, ${bundleAmount * 2}, …).`,
              }),
              { status: 400 }
            );
          }
        } else if (quantity % bundleAmount !== 0) {
          return new Response(
            JSON.stringify({
              error: `Quantity must be a multiple of ${bundleAmount} ${quantity_unit} for this pack (e.g. ${bundleAmount}, ${bundleAmount * 2}, …).`,
            }),
            { status: 400 }
          );
        }
      }

      const bundleCount = isPreorderCandidate ? (perBase ? quantity : quantity / bundleAmount) : quantity / bundleAmount;
      if (!Number.isFinite(bundleCount) || bundleCount <= 0) {
        return new Response(JSON.stringify({ error: "Invalid quantity" }), { status: 400 });
      }

      const { data: sellerForLimits } = await supabase
        .from("sellers")
        .select("min_order_amount")
        .eq("id", listing.seller_id)
        .single();
      const minOrderAmt = Number(sellerForLimits?.min_order_amount) || 0;
      const pricingOpts = getListingPriceOptions(listing);
      const dailyCapFloor = minimumRequiredBuyerDailyCap(pricingOpts, minOrderAmt);

      if (listing.buyer_daily_qty_limit != null && Number(listing.buyer_daily_qty_limit) > 0) {
        const cap = Number(listing.buyer_daily_qty_limit);
        if (cap < dailyCapFloor) {
          return new Response(
            JSON.stringify({
              error: `Per-buyer daily limit must be at least ${dailyCapFloor} ${quantity_unit} (covers at least one smallest pack and your seller minimum order ₹${minOrderAmt || 0}). Raise the limit on the listing or adjust pricing.`,
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

      // Single inventory number for the listing (`fish_listings.weight_avail`), in the chosen tier’s unit (pc / kg / g). DB `create_order_atomic` subtracts `quantity` from this field only — no per-tier stock.
      const weightAvail = Number(listing.weight_avail);
      const availOk = Number.isFinite(weightAvail) ? weightAvail : 0;
      if (!listing.is_available || availOk <= 0 || availOk < quantity) {
        if (scheduled_for) {
          const { data: schedSeller } = await supabase
            .from("sellers")
            .select("schedule_pickup_slots")
            .eq("id", listing.seller_id)
            .single();
          if (!schedSeller?.schedule_pickup_slots) {
            return new Response(
              JSON.stringify({ error: "Pickup scheduling is not available for this seller." }),
              { status: 400 }
            );
          }
        }
        // Always allow as pre-order — no stock deduction, no blocking
        total_price = linePrice * bundleCount;
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
            ...(buyer_notes ? { buyer_notes: String(buyer_notes).slice(0, 500) } : {}),
            ...(cut_style ? { cut_style: String(cut_style).slice(0, 50) } : {}),
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
              body: JSON.stringify({ seller_id, species: species || "Fish", quantity, quantity_unit, scheduled_for: scheduled_for || null }),
            });
          } catch {}
        }

        const pre_order_reason = !listing.is_available ? "unavailable" : "out_of_stock";
        return new Response(JSON.stringify({ order: preOrder, pre_order_reason }), { status: 201 });
      }

      total_price = linePrice * bundleCount;
      seller_id = listing.seller_id;
    } else if (species) {
      const { data: range } = await supabase
        .from("species_ranges")
        .select("max_price")
        .eq("species", species)
        .single();

      total_price = (range?.max_price || 0) * quantity;
    }

    if (!listing_id) {
      if (quantity_unit === "kg") {
        quantity = Math.round(Number(quantity) * 100) / 100;
      } else {
        quantity = Math.floor(Number(quantity));
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return new Response(JSON.stringify({ error: "Invalid quantity" }), { status: 400 });
      }
    }

    // Determine order status: scheduled > pre_order > pending
    let status = "pending";
    let delivery_fee = 0;
    if (scheduled_for && !seller_id) {
      return new Response(JSON.stringify({ error: "Scheduled orders require a seller." }), { status: 400 });
    }
    if (seller_id) {
      const { data: seller } = await supabase
        .from("sellers")
        .select(
          "opens_at, closes_at, accepts_preorder, has_delivery, min_order_amount, delivery_fee_enabled, delivery_fee_amount, free_delivery_above, schedule_pickup_slots, preorder_cutoff_time, open_days, preorder_days"
        )
        .eq("id", seller_id)
        .single();

      if (scheduled_for) {
        if (!seller?.schedule_pickup_slots) {
          return new Response(
            JSON.stringify({ error: "Pickup scheduling is not available for this seller." }),
            { status: 400 }
          );
        }
        status = "scheduled";
      } else {
        const DAY_NAMES = ['sun','mon','tue','wed','thu','fri','sat'];
        const todayName = DAY_NAMES[new Date().getDay()];

        // open_days: if set+non-empty, today must be in it (seller's day off otherwise)
        const isTodayOrderDay = !seller?.open_days?.length || seller.open_days.includes(todayName);
        // preorder_days: if set+non-empty use it; else fall back to accepts_preorder boolean
        const isTodayPreorderDay = (seller?.preorder_days && seller.preorder_days.length > 0)
          ? seller.preorder_days.includes(todayName)
          : !!seller?.accepts_preorder;

        const openByTime = seller ? isSellerCurrentlyOpen(seller.opens_at, seller.closes_at) : true;
        const sellerEffectivelyOpen = isTodayOrderDay && openByTime;

        if (!sellerEffectivelyOpen) {
          // Seller closed or day-off — try pre_order path
          if (!isTodayPreorderDay) {
            const dayLabel = !isTodayOrderDay ? "not open today" : "closed now";
            return new Response(
              JSON.stringify({ error: `This seller is ${dayLabel} and does not accept pre-orders for next day. Check back when they open.` }),
              { status: 400 }
            );
          }

          // Per-listing preorder gate
          if (listing_id) {
            const { data: listingForPreorder } = await supabase
              .from("fish_listings")
              .select("is_preorder_enabled")
              .eq("id", listing_id)
              .single();
            if (listingForPreorder?.is_preorder_enabled === false) {
              return new Response(JSON.stringify({ error: "Pre-orders are not available for this item." }), { status: 400 });
            }
          } else if (!seller?.accepts_preorder && !isTodayPreorderDay) {
            return new Response(JSON.stringify({ error: "This seller is not accepting pre-orders." }), { status: 400 });
          }

          // Enforce preorder cutoff time — compare in IST (UTC+5:30)
          if (seller?.preorder_cutoff_time) {
            const nowISTMs = Date.now() + 5.5 * 60 * 60 * 1000;
            const nowIST = new Date(nowISTMs);
            const nowMinutes = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
            const [cutHour, cutMin] = (seller.preorder_cutoff_time as string).split(":").map(Number);
            const cutoffMinutes = cutHour * 60 + cutMin;
            if (nowMinutes >= cutoffMinutes) {
              return new Response(
                JSON.stringify({ error: `Pre-order cutoff time (${seller.preorder_cutoff_time} IST) has passed. Try again tomorrow.` }),
                { status: 400 }
              );
            }
          }

          status = "pre_order";
        }
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
      // If function doesn't exist, overload is ambiguous (apply migration 025), or stock error, try direct insert as fallback
      if (
        msg.includes("could not find") ||
        msg.includes("does not exist") ||
        msg.includes("42883") ||
        msg.includes("Could not choose the best candidate function")
      ) {
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
            ...(buyer_notes ? { buyer_notes: String(buyer_notes).slice(0, 500) } : {}),
            ...(cut_style ? { cut_style: String(cut_style).slice(0, 50) } : {}),
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
        const statusLabel = status === "scheduled" ? "Order Scheduled" : status === "pre_order" ? "Pre-order Placed" : "Order Placed";
        const emailArgs = {
          statusLabel,
          species: species || "Fish",
          quantity,
          quantity_unit,
          totalAmount: total_price + delivery_fee,
          deliveryFee: delivery_fee,
          orderId: order.id,
          scheduled_for,
          buyerNotes: buyer_notes ? String(buyer_notes).slice(0, 500) : null,
          cutStyle: cut_style ? String(cut_style).slice(0, 50) : null,
        };
        // Email buyer
        if (buyer_id) {
          const { data: buyer } = await supabase.from("buyers").select("email").eq("id", buyer_id).single();
          if (buyer?.email) {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ from: "Relifish <noreply@relifish.store>", to: buyer.email, subject: `${statusLabel} — ${species || "Fish"}`, html: orderEmailBuyer(emailArgs) }),
            });
          }
        }
        // Email seller
        if (seller_id) {
          const { data: sellerData } = await supabase.from("sellers").select("email").eq("id", seller_id).single();
          if (sellerData?.email) {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ from: "Relifish <noreply@relifish.store>", to: sellerData.email, subject: `New Order: ${species || "Fish"}`, html: orderEmailSeller(emailArgs) }),
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
