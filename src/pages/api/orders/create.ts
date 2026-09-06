import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { computeDeliveryFee, haversineKm } from "../../../lib/order-pricing";
import {
  capitalizeFishName,
  orderEmailBuyer,
  orderEmailSeller,
  type OrderEmailArgs,
} from "../../../lib/email-templates";
import { getListingOptionById, type ListingPricingSource } from "../../../lib/listing-pricing";
import type { PlacementKind } from "../../../lib/order-timing";
import { classifyPlacementAtOrderTime, closedSellerMessage } from "../../../lib/order-timing";
import { sendBuyerOrderPush } from "../../../lib/server/buyer-push";
import { resolveListingOrderLine } from "../../../lib/server/resolve-listing-order-line";
import { internalHeaders } from "../../../lib/server/internal-auth";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

/**
 * POST /api/orders/create
 * Placement kind = seller shopping hours + order time only (see order-timing.ts).
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
      schedule_slot_id: _schedule_slot_id,
      pricing_option_id: clientPricingOptionId,
      buyer_notes,
      cut_style,
    } = body;

    if (scheduled_for) {
      return new Response(
        JSON.stringify({ error: "Scheduled pickup slots are not available. Order for now or during pre-order hours." }),
        { status: 400 }
      );
    }

    let quantity = typeof rawQuantity === "number" ? rawQuantity : parseFloat(String(rawQuantity));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return new Response(JSON.stringify({ error: "Invalid quantity" }), { status: 400 });
    }

    if (!buyer_phone) {
      return new Response(JSON.stringify({ error: "Phone number required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let total_price = 0;
    let seller_id: string | null = clientSellerId || null;
    let orderPricingOptionId: string | null = null;
    let orderPricingLabel: string | null = null;
    let placement_kind: PlacementKind = "same_day";
    let listingPricingOptions: unknown = null;

    if (listing_id) {
      const resolved = await resolveListingOrderLine(supabase, {
        listing_id,
        pricing_option_id: clientPricingOptionId,
        rawQuantity: quantity,
        buyer_phone,
        buyer_id,
      });
      if (!resolved.ok) {
        return new Response(JSON.stringify({ error: resolved.error }), { status: resolved.status });
      }

      const line = resolved.line;
      placement_kind = line.placement_kind;
      total_price = line.total_price;
      seller_id = line.seller_id;
      quantity = line.quantity;
      quantity_unit = line.quantity_unit;
      orderPricingOptionId = line.pricing_option_id;
      orderPricingLabel = line.pricing_label;
      species = species || line.species;

      const { data: listingRow } = await supabase
        .from("fish_listings")
        .select("pricing_options")
        .eq("id", listing_id)
        .single();
      listingPricingOptions = listingRow?.pricing_options;

      if (line.kind === "preorder") {
        const { data: preOrder, error: preErr } = await supabase
          .from("orders")
          .insert({
            listing_id,
            species: species || null,
            buyer_phone,
            buyer_id: buyer_id || null,
            buyer_addr: buyer_addr || null,
            quantity,
            quantity_unit,
            total_price,
            delivery_fee: 0,
            platform_fee: 0,
            status: "pending_payment",
            placement_kind: "preorder",
            is_preorder: true,
            order_type,
            payment_type: "cod",
            paid_amount: total_price,
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

        if (seller_id) {
          fetch(`${url.origin}/api/notify-seller`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...internalHeaders() },
            body: JSON.stringify({ seller_id, species: species || "Fish", quantity, quantity_unit, placement_kind: "preorder", order_id: preOrder.id }),
          }).catch(() => {});
        }

        sendBuyerOrderPush({ buyer_id: buyer_id || null, buyer_phone, status: "placed", species: species || "Fish", order_id: preOrder.id }).catch(() => {});

        if (resendApiKey) {
          const pLine = line as import("../../../lib/server/resolve-listing-order-line").PreorderLinePayload;
          const bs = (line as any).bundle_size && (line as any).bundle_size > 0 && (line as any).bundle_size !== 1 ? (line as any).bundle_size : null;
          const poEmailArgs: OrderEmailArgs = {
            statusLabel: "Pre-order placed — catch reserved for tomorrow",
            species: species || "Fish",
            quantity,
            quantity_unit,
            totalAmount: total_price,
            deliveryFee: 0,
            orderId: preOrder.id,
            scheduled_for: null,
            isPreorder: true,
            preorderMin: pLine.preorder_price_min ?? null,
            preorderMax: pLine.preorder_price_max ?? null,
            bundleSize: bs,
            bundleCount: bs ? Math.round(quantity / bs) : null,
            pricingLabel: orderPricingLabel || null,
          };
          const speciesLabel = capitalizeFishName(species || "Fish");
          if (buyer_id) {
            supabase.from("buyers").select("email").eq("id", buyer_id).single().then(({ data: b }) => {
              if (b?.email) fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: "Relifish <noreply@relifish.store>", to: b.email, subject: `Pre-order placed — ${speciesLabel}`, html: orderEmailBuyer(poEmailArgs) }) }).catch(() => {});
            }).catch(() => {});
          }
          supabase.from("sellers").select("email").eq("id", seller_id).single().then(({ data: sd }) => {
            if (sd?.email) fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: "Relifish <noreply@relifish.store>", to: sd.email, subject: `New pre-order: ${speciesLabel}`, html: orderEmailSeller({ ...poEmailArgs, buyerPhone: buyer_phone }) }) }).catch(() => {});
          }).catch(() => {});
        }

        return new Response(JSON.stringify({ order: preOrder, placement_kind: "preorder" }), { status: 201 });
      }
    } else if (species) {
      const { data: range } = await supabase
        .from("species_ranges")
        .select("max_price")
        .eq("species", species)
        .single();
      total_price = (range?.max_price || 0) * quantity;
    } else {
      return new Response(JSON.stringify({ error: "listing_id or species required" }), { status: 400 });
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

    // Pay-first: new orders are pending_payment until buyer uploads proof; seller confirms after verify.
    let status = "pending_payment";
    let isPreorderBranch = false;
    let delivery_fee = 0;

    if (seller_id) {
      const { data: seller } = await supabase
        .from("sellers")
        .select(
          "opens_at, closes_at, accepts_preorder, has_delivery, has_pickup, min_order_amount, delivery_fee_enabled, delivery_fee_amount, delivery_fee_type, delivery_fee_per_km, free_delivery_above, preorder_cutoff_time, open_days, preorder_days, lat, lng"
        )
        .eq("id", seller_id)
        .single();

      // Hoisted so the assignment at end of block sees it in both branches
      // (BUG-11 fix: was `const` inside `else` → ReferenceError at line 244
      // for every non-scheduled checkout → 500 on all same-day POSTs).
      let placementKind: "same_day" | "preorder" | "closed" | "scheduled" = "same_day";

      if (scheduled_for) {
        if (!seller?.schedule_pickup_slots) {
          return new Response(
            JSON.stringify({ error: "Pickup scheduling is not available for this seller." }),
            { status: 400 }
          );
        }
        status = "pending_payment";
        placementKind = "scheduled";
      } else {
        placementKind = seller ? classifyPlacementAtOrderTime(seller) : "same_day";

        if (placementKind === "closed") {
          return new Response(
            JSON.stringify({ error: closedSellerMessage(seller!) }),
            { status: 400 }
          );
        }

        if (placementKind === "preorder") {
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
          }
          status = "pending_payment";
          isPreorderBranch = true;
        }
      }
      placement_kind = placementKind as PlacementKind;

      const minAmt = Number(seller?.min_order_amount) || 0;
      if (minAmt > 0 && total_price < minAmt) {
        return new Response(JSON.stringify({ error: `Minimum order for this seller is ₹${minAmt}` }), {
          status: 400,
        });
      }

      if (order_type === "delivery" && !seller?.has_delivery) {
        return new Response(JSON.stringify({ error: "This seller does not offer delivery" }), { status: 400 });
      }
      if (order_type === "pickup" && seller?.has_pickup === false) {
        return new Response(JSON.stringify({ error: "This seller does not offer pickup" }), { status: 400 });
      }

      let deliveryDistanceKm: number | undefined = undefined;
      if (order_type === "delivery" && buyer_addr && seller?.lat != null && seller?.lng != null) {
        const { data: addrRow } = await supabase
          .from("buyer_addresses")
          .select("lat, lng")
          .eq("id", buyer_addr)
          .single();
        if (addrRow?.lat != null && addrRow?.lng != null) {
          deliveryDistanceKm = haversineKm(
            Number(seller.lat), Number(seller.lng),
            Number(addrRow.lat), Number(addrRow.lng)
          );
        }
      }
      delivery_fee = seller ? computeDeliveryFee(seller, total_price, order_type, deliveryDistanceKm) : 0;
    }

    let order: { id: string; buyer_id?: string | null; status?: string } | null = null;

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
      p_scheduled_for: null,
      p_schedule_slot_id: null,
      p_pricing_option_id: orderPricingOptionId,
      p_pricing_label: orderPricingLabel,
    });

    if (rpcError) {
      const msg = rpcError.message || "";
      if (
        msg.includes("could not find") ||
        msg.includes("does not exist") ||
        msg.includes("42883") ||
        msg.includes("Could not choose the best candidate function")
      ) {
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
            placement_kind,
            order_type,
            payment_type: "cod",
            paid_amount: total_price + delivery_fee,
            pricing_option_id: orderPricingOptionId,
            pricing_label: orderPricingLabel,
            is_preorder: isPreorderBranch,
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
        const isStockError = msg.includes("in stock") || msg.includes("Listing not found");
        return new Response(JSON.stringify({ error: msg }), { status: isStockError ? 400 : 500 });
      }
    } else {
      const { data: fetchedOrder, error: fetchErr } = await supabase
        .from("orders")
        .select()
        .eq("id", orderId)
        .single();
      if (fetchErr) {
        return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
      }
      order = fetchedOrder;
      await supabase.from("orders").update({ placement_kind, is_preorder: isPreorderBranch }).eq("id", orderId);
      order = { ...order, placement_kind, is_preorder: isPreorderBranch };
    }

    if (!order) {
      return new Response(JSON.stringify({ error: "Order creation failed" }), { status: 500 });
    }

    if (seller_id) {
      try {
        await fetch(`${url.origin}/api/notify-seller`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...internalHeaders() },
          body: JSON.stringify({
            seller_id,
            species: species || "Fish",
            quantity,
            quantity_unit,
            placement_kind,
            buyer_phone,
            order_id: order.id,
          }),
        });
      } catch {
        /* non-blocking */
      }
    }

    if (order.id && (order.buyer_id || buyer_phone)) {
      try {
        await sendBuyerOrderPush({
          buyer_id: order.buyer_id,
          buyer_phone,
          status: "placed",
          species: species || "Fish",
          order_id: order.id,
        });
      } catch {
        /* non-blocking */
      }
    }

    // Send emails non-blocking — fire and forget so order response is instant
    if (resendApiKey && order) {
      const RAZORPAY_ENABLED = import.meta.env.PUBLIC_ENABLE_RAZORPAY === "true";
      const statusLabel = isPreorderBranch
        ? "Pre-order placed — catch reserved for tomorrow"
        : RAZORPAY_ENABLED
          ? "Order placed — complete payment to confirm"
          : "Order placed — upload payment proof";
      const emailArgs = {
        statusLabel,
        species: species || "Fish",
        quantity,
        quantity_unit,
        totalAmount: total_price + delivery_fee,
        deliveryFee: delivery_fee,
        orderId: order.id,
        scheduled_for,
        isPreorder: isPreorderBranch,
        buyerNotes: buyer_notes ? String(buyer_notes).slice(0, 500) : null,
        cutStyle: cut_style ? String(cut_style).slice(0, 50) : null,
        bundleSize: null,
        bundleCount: null,
        pricingLabel: orderPricingLabel || null,
      };
      const speciesForEmail = capitalizeFishName(species || "Fish");

      // Buyer email — async, does not block response
      if (buyer_id) {
        supabase.from("buyers").select("email").eq("id", buyer_id).single().then(({ data: buyer }) => {
          if (buyer?.email) {
            fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ from: "Relifish <noreply@relifish.store>", to: buyer.email, subject: `${statusLabel} — ${speciesForEmail}`, html: orderEmailBuyer(emailArgs) }),
            }).catch(() => {});
          }
        }).catch(() => {});
      }

      // Seller email — async, does not block response
      if (seller_id) {
        supabase.from("sellers").select("email").eq("id", seller_id).single().then(({ data: sellerData }) => {
          if (sellerData?.email) {
            fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ from: "Relifish <noreply@relifish.store>", to: sellerData.email, subject: isPreorderBranch ? `New pre-order: ${speciesForEmail}` : `New order: ${speciesForEmail}`, html: orderEmailSeller(emailArgs) }),
            }).catch(() => {});
          }
        }).catch(() => {});
      }
    }

    return new Response(JSON.stringify({ order, placement_kind }), { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Order create error:", err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
