import type { APIRoute } from "astro";
import { requireBuyer } from "../../../lib/server/session";
import { createClient } from "@supabase/supabase-js";
import { normalizeIndianMobile } from "../../../lib/indian-phone";
import { resolveOrderAddress, saveAddressSnapshot } from "../../../lib/server/order-address";
import { computeDeliveryFee, haversineKm } from "../../../lib/order-pricing";
import {
  capitalizeFishName,
  orderEmailBuyer,
  type OrderEmailArgs,
  UNPAID_EMAIL_LABEL,
  UNPAID_EMAIL_NOTE,
} from "../../../lib/email-templates";
import { getListingOptionById, type ListingPricingSource } from "../../../lib/listing-pricing";
import type { PlacementKind } from "../../../lib/order-timing";
import { classifyPlacementAtOrderTime, closedSellerMessage, preorderDeliveryDateIST, preorderPlacedLabel } from "../../../lib/order-timing";
import { sendBuyerOrderPush } from "../../../lib/server/buyer-push";
import { resolveListingOrderLine } from "../../../lib/server/resolve-listing-order-line";
import { sendTransactionalEmail } from "../../../lib/server/send-email";
import { sellerRejectionReason, deliveryDistanceRejection } from "../../../lib/server/assert-seller-accepts";
import { afterResponse } from "../../../lib/server/after-response";
import { checkDeliverySlot, slotDateIST, slotLabel, SLOT_SELLER_COLUMNS } from "../../../lib/delivery-slots";

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
      delivery_slot_start,
    } = body;
    if (buyer_id) { const denied = requireBuyer(request, buyer_id); if (denied) return denied; }

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
    // One stored format (10 digits) across orders/buyers/sellers. Orders used to
    // keep whatever the client sent: prod had 218 "+91…" rows and 117 10-digit.
    const phoneCheck = normalizeIndianMobile(String(buyer_phone));
    if (!phoneCheck.ok) {
      return new Response(JSON.stringify({ error: phoneCheck.message }), { status: 400 });
    }
    buyer_phone = phoneCheck.digits10;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const addr = await resolveOrderAddress(supabase, buyer_addr, buyer_id);
    if (!addr.ok) {
      return new Response(JSON.stringify({ error: addr.error }), { status: 400 });
    }

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
        // BUG-46: this branch returns 201 before the `if (seller_id)` block
        // below, so these seller-level gates were skipped entirely during the
        // pre-order window — a seller with has_delivery=false could receive a
        // delivery pre-order under their own minimum, with no delivery fee.
        const { data: preorderSeller } = await supabase
          .from("sellers")
          .select(`min_order_amount, has_delivery, has_pickup, delivery_fee_enabled, delivery_fee_amount, delivery_fee_type, delivery_fee_per_km, free_delivery_above, delivery_rad, lat, lng, ${SLOT_SELLER_COLUMNS}`)
          .eq("id", line.seller_id)
          .single();

        const preorderRejection = sellerRejectionReason(preorderSeller, { order_type, total_price });
        if (preorderRejection) {
          return new Response(JSON.stringify({ error: preorderRejection }), { status: 400 });
        }

        let preorderDistanceKm: number | undefined = undefined;
        const addrRow = addr.snapshot;
        if (order_type === "delivery" && preorderSeller?.lat != null && preorderSeller?.lng != null) {
          if (addrRow?.lat != null && addrRow?.lng != null) {
            preorderDistanceKm = haversineKm(
              Number(preorderSeller.lat), Number(preorderSeller.lng),
              Number(addrRow.lat), Number(addrRow.lng)
            );
          }
        }
        const preDistErr = deliveryDistanceRejection(preorderSeller, order_type, preorderDistanceKm);
        if (preDistErr) {
          return new Response(JSON.stringify({ error: preDistErr }), { status: 400 });
        }
        // ponytail: this single-item route keeps the clock's kind; only the cart checkout lets the
        // picked day turn an order into a pre-order. A slot of the other kind is refused.
        const preSlot = checkDeliverySlot(preorderSeller, order_type, delivery_slot_start);
        if (preSlot.error || (preSlot.kind && preSlot.kind !== "preorder")) {
          return new Response(JSON.stringify({ error: preSlot.error || "Pick a pre-order delivery time.", code: "slot_unavailable" }), { status: 400 });
        }
        const preorderDeliveryFee = preorderSeller
          ? computeDeliveryFee(preorderSeller, total_price, order_type, preorderDistanceKm)
          : 0;

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
            delivery_fee: preorderDeliveryFee,
            platform_fee: 0,
            status: "pending_payment",
            placement_kind: "preorder",
            is_preorder: true,
            order_type,
            // What Razorpay charges: total + delivery fee (refunds use this).
            paid_amount: total_price + preorderDeliveryFee,
            pricing_option_id: orderPricingOptionId,
            pricing_label: orderPricingLabel,
            ...(preSlot.slot ? { delivery_slot_start: preSlot.slot.start, delivery_slot_end: preSlot.slot.end } : {}),
            ...(buyer_notes ? { buyer_notes: String(buyer_notes).slice(0, 500) } : {}),
            ...(cut_style ? { cut_style: String(cut_style).slice(0, 50) } : {}),
          })
          .select()
          .single();

        if (preErr) {
          return new Response(JSON.stringify({ error: preErr.message }), { status: 500 });
        }
        await saveAddressSnapshot(supabase, [preOrder.id], addr.snapshot);

        // BUG-27: these were fire-and-forget. Vercel freezes the function the
        // moment the response is returned, so in-flight push/email requests were
        // killed and the notification simply never arrived. Awaited now.
        const preNotify: Promise<unknown>[] = [];
        preNotify.push(
          sendBuyerOrderPush({ buyer_id: buyer_id || null, buyer_phone, status: "placed", species: species || "Fish", order_id: preOrder.id })
            .catch((err) => console.warn("[orders/create] preorder buyer push failed", { order_id: preOrder.id, err: err?.message }))
        );

        if (resendApiKey) {
          const pLine = line as import("../../../lib/server/resolve-listing-order-line").PreorderLinePayload;
          const bs = (line as any).bundle_size && (line as any).bundle_size > 0 && (line as any).bundle_size !== 1 ? (line as any).bundle_size : null;
          const poEmailArgs: OrderEmailArgs = {
            statusLabel: preorderPlacedLabel(preSlot.slot ? slotDateIST(preSlot.slot.start) : pLine.delivery_date),
            species: species || "Fish",
            quantity,
            quantity_unit,
            totalAmount: total_price,
            deliveryFee: 0,
            orderId: preOrder.id,
            scheduled_for: null,
            isPreorder: true,
            deliverySlot: preSlot.slot ? slotLabel(preSlot.slot.start, preSlot.slot.end) : null,
            preorderMin: pLine.preorder_price_min ?? null,
            preorderMax: pLine.preorder_price_max ?? null,
            bundleSize: bs,
            bundleCount: bs ? Math.round(quantity / bs) : null,
            pricingLabel: orderPricingLabel || null,
          };
          const speciesLabel = capitalizeFishName(species || "Fish");
          if (buyer_id) {
            preNotify.push(
              supabase.from("buyers").select("email").eq("id", buyer_id).single().then(({ data: b }) =>
                sendTransactionalEmail(b?.email, `Pre-order placed — ${speciesLabel}`, orderEmailBuyer(poEmailArgs), "preorder-buyer")
              )
            );
          }
        }

        afterResponse(Promise.allSettled(preNotify), "orders/create:preorder");

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

    // Pay-first: new orders are pending_payment until the Razorpay payment is captured.
    let status = "pending_payment";
    let isPreorderBranch = false;
    let preorderDeliveryDate: string | null = null;
    let delivery_fee = 0;
    let slotCols: { delivery_slot_start?: string; delivery_slot_end?: string } = {};

    if (seller_id) {
      const { data: seller } = await supabase
        .from("sellers")
        .select(
          "opens_at, closes_at, accepts_preorder, has_delivery, has_pickup, min_order_amount, delivery_fee_enabled, delivery_fee_amount, delivery_fee_type, delivery_fee_per_km, free_delivery_above, delivery_rad, preorder_cutoff_time, preorder_opens_at, delivery_days, open_days, preorder_days, lat, lng, delivery_slots_enabled, delivery_slot_minutes, preorder_delivery_start, preorder_delivery_end, preorder_days_ahead"
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
          preorderDeliveryDate = preorderDeliveryDateIST(seller!);
        }
      }
      placement_kind = placementKind as PlacementKind;

      const rejection = sellerRejectionReason(seller, { order_type, total_price });
      if (rejection) {
        return new Response(JSON.stringify({ error: rejection }), { status: 400 });
      }

      let deliveryDistanceKm: number | undefined = undefined;
      const addrRow = addr.snapshot;
      if (order_type === "delivery" && seller?.lat != null && seller?.lng != null) {
        if (addrRow?.lat != null && addrRow?.lng != null) {
          deliveryDistanceKm = haversineKm(
            Number(seller.lat), Number(seller.lng),
            Number(addrRow.lat), Number(addrRow.lng)
          );
        }
      }
      const distErr = deliveryDistanceRejection(seller, order_type, deliveryDistanceKm);
      if (distErr) {
        return new Response(JSON.stringify({ error: distErr }), { status: 400 });
      }
      delivery_fee = seller ? computeDeliveryFee(seller, total_price, order_type, deliveryDistanceKm) : 0;
      const slotCheck = checkDeliverySlot(seller, order_type, delivery_slot_start);
      if (slotCheck.error || (slotCheck.kind && slotCheck.kind !== placement_kind)) {
        return new Response(JSON.stringify({ error: slotCheck.error || "Pick a delivery time for this kind of order.", code: "slot_unavailable" }), { status: 400 });
      }
      if (slotCheck.slot) slotCols = { delivery_slot_start: slotCheck.slot.start, delivery_slot_end: slotCheck.slot.end };
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
            paid_amount: total_price + delivery_fee,
            pricing_option_id: orderPricingOptionId,
            pricing_label: orderPricingLabel,
            is_preorder: isPreorderBranch,
            ...slotCols,
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
      await supabase.from("orders").update({ placement_kind, is_preorder: isPreorderBranch, ...slotCols }).eq("id", orderId);
      order = { ...order, placement_kind, is_preorder: isPreorderBranch, ...slotCols };
    }

    if (!order) {
      return new Response(JSON.stringify({ error: "Order creation failed" }), { status: 500 });
    }
    await saveAddressSnapshot(supabase, [order.id], addr.snapshot);

    if (order.id && (order.buyer_id || buyer_phone)) {
      try {
        await sendBuyerOrderPush({
          buyer_id: order.buyer_id,
          buyer_phone,
          status: "placed",
          species: species || "Fish",
          order_id: order.id,
        });
      } catch (err) {
        console.warn("[orders/create] buyer push failed", { order_id: order.id, err: (err as any)?.message });
      }
    }

    // Send emails non-blocking — fire and forget so order response is instant
    if (resendApiKey && order) {
      const statusLabel = isPreorderBranch
        ? preorderPlacedLabel(slotCols.delivery_slot_start ? slotDateIST(slotCols.delivery_slot_start) : preorderDeliveryDate)
        : UNPAID_EMAIL_LABEL;
      const emailArgs = {
        statusLabel,
        note: isPreorderBranch ? undefined : UNPAID_EMAIL_NOTE,
        species: species || "Fish",
        quantity,
        quantity_unit,
        totalAmount: total_price + delivery_fee,
        deliveryFee: delivery_fee,
        orderId: order.id,
        scheduled_for,
        isPreorder: isPreorderBranch,
        deliverySlot: slotCols.delivery_slot_start ? slotLabel(slotCols.delivery_slot_start, slotCols.delivery_slot_end!) : null,
        buyerNotes: buyer_notes ? String(buyer_notes).slice(0, 500) : null,
        cutStyle: cut_style ? String(cut_style).slice(0, 50) : null,
        bundleSize: null,
        bundleCount: null,
        pricingLabel: orderPricingLabel || null,
      };
      const speciesForEmail = capitalizeFishName(species || "Fish");

      // BUG-27: awaited in parallel. Previously fire-and-forget, which Vercel
      // cancels on response — the order-placed mail was lost roughly whenever
      // Resend was slower than the response.
      const mail: Promise<unknown>[] = [];
      if (buyer_id) {
        mail.push(
          supabase.from("buyers").select("email").eq("id", buyer_id).single().then(({ data: buyer }) =>
            sendTransactionalEmail(buyer?.email, `${statusLabel} — ${speciesForEmail}`, orderEmailBuyer(emailArgs), "order-buyer")
          ).catch((err) => console.warn("[orders/create] buyer email lookup failed", { err: err?.message }))
        );
      }
      afterResponse(Promise.allSettled(mail), "orders/create:email");
    }

    // Sellers hear about an order only once it is paid (founder, 27 Oct).
    return new Response(JSON.stringify({ order, placement_kind }), { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Order create error:", err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
