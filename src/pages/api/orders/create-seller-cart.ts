import type { APIRoute } from "astro";
import { requireBuyer } from "../../../lib/server/session";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeIndianMobile } from "../../../lib/indian-phone";
import { deliveryDistanceRejection } from "../../../lib/server/assert-seller-accepts";
import { resolveOrderAddress, saveAddressSnapshot } from "../../../lib/server/order-address";
import { computeDeliveryFee, haversineKm } from "../../../lib/order-pricing";
import {
  capitalizeFishName,
  orderEmailBuyer,
  orderEmailSeller,
  type OrderEmailArgs,
  type OrderEmailItem,
} from "../../../lib/email-templates";
import { getListingOptionById, type ListingPricingSource } from "../../../lib/listing-pricing";
import { preorderPlacedLabel, type PlacementKind } from "../../../lib/order-timing";
import { sendBuyerOrderPush } from "../../../lib/server/buyer-push";
import { pickUtm } from "../../../lib/utm";
import { pickPreferences } from "../../../lib/preferences";
import { resolveListingOrderLine, type PreorderLinePayload } from "../../../lib/server/resolve-listing-order-line";
import { internalHeaders } from "../../../lib/server/internal-auth";
import { sendTransactionalEmail } from "../../../lib/server/send-email";
import { afterResponse } from "../../../lib/server/after-response";
import { cartLabel } from "../../../lib/server/order-cart";
import { metaEvent, metaUserFromRequest } from "../../../lib/server/meta-capi";
import { checkDeliverySlot, slotDateIST, slotLabel, SLOT_SELLER_COLUMNS } from "../../../lib/delivery-slots";

type ResolvedRow = Awaited<ReturnType<typeof resolveListingOrderLine>> extends { ok: true; line: infer L }
  ? { line: L }
  : never;

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

type CartLineInput = {
  listing_id: string;
  quantity: number;
  quantity_unit?: string;
  pricing_option_id?: string | null;
  species?: string | null;
};

/**
 * POST /api/orders/create-seller-cart
 * Multi-line checkout for one seller. Placement kind = shopping hours + order time only.
 */
export const POST: APIRoute = async ({ request, url }) => {
  try {
    const body = await request.json();
    let {
      lines: rawLines,
      buyer_phone,
      buyer_id,
      buyer_addr,
      order_type = "pickup",
      seller_id: clientSellerId,
      scheduled_for,
      buyer_notes,
      cut_style,
      utm,
      placement_kind: expectedPlacement,
      meta_event_id,
      delivery_slot_start,
    } = body;
    if (buyer_id) { const denied = requireBuyer(request, buyer_id); if (denied) return denied; }

    if (scheduled_for) {
      return new Response(
        JSON.stringify({ error: "Scheduled pickup slots are not available. Order for now or during pre-order hours." }),
        { status: 400 }
      );
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
    if (!clientSellerId || typeof clientSellerId !== "string") {
      return new Response(JSON.stringify({ error: "seller_id required" }), { status: 400 });
    }
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      return new Response(JSON.stringify({ error: "lines array required" }), { status: 400 });
    }

    if (order_type === "delivery" && !buyer_addr) {
      return new Response(JSON.stringify({ error: "Pick a delivery address" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const resolved: ResolvedRow[] = [];
    // One clock for the whole cart, so lines can't straddle closing time.
    const nowMs = Date.now();
    const qtyByListing = new Map<string, number>();

    const { data: seller } = await supabase
      .from("sellers")
      .select(
        `has_delivery, has_pickup, min_order_amount, delivery_fee_enabled, delivery_fee_amount, delivery_fee_type, delivery_fee_per_km, free_delivery_above, delivery_rad, lat, lng, ${SLOT_SELLER_COLUMNS}`
      )
      .eq("id", clientSellerId)
      .single();
    // Delivery time slot: required when the seller has slots on, and must be one offered now.
    // Its day decides the kind: Today = same-day, a later delivery day = pre-order (any hour).
    const slotCheck = checkDeliverySlot(seller, order_type, delivery_slot_start, nowMs);
    if (slotCheck.error) {
      return new Response(JSON.stringify({ error: slotCheck.error, code: "slot_unavailable" }), { status: 400 });
    }
    const slotCols = slotCheck.slot ? { delivery_slot_start: slotCheck.slot.start, delivery_slot_end: slotCheck.slot.end } : {};

    for (const raw of rawLines as CartLineInput[]) {
      if (!raw?.listing_id) {
        return new Response(JSON.stringify({ error: "Each line needs listing_id" }), { status: 400 });
      }
      const r = await resolveListingOrderLine(supabase, {
        listing_id: raw.listing_id,
        pricing_option_id: raw.pricing_option_id,
        rawQuantity: raw.quantity,
        buyer_phone,
        buyer_id,
        nowMs,
        priorQty: qtyByListing.get(raw.listing_id) || 0,
        placement: slotCheck.kind,
      });
      if (!r.ok) {
        return new Response(JSON.stringify({ error: r.error, ...((r as any).code ? { code: (r as any).code } : {}) }), { status: r.status });
      }
      if (r.line.seller_id !== clientSellerId) {
        return new Response(JSON.stringify({ error: "All items must be from the same seller" }), { status: 400 });
      }
      resolved.push({ line: r.line });
      qtyByListing.set(raw.listing_id, (qtyByListing.get(raw.listing_id) || 0) + r.line.quantity);
    }

    const cartSubtotal = resolved.reduce((s, x) => s + x.line.total_price, 0);
    const placement_kind: PlacementKind = resolved.some((x) => x.line.placement_kind === "preorder")
      ? "preorder"
      : "same_day";
    // The page decides same-day vs pre-order when it loads. If the shop opened or
    // closed since, the cart's prices and promise ("today" vs "tomorrow's catch")
    // are stale: refuse instead of silently charging the other price.
    if (expectedPlacement && expectedPlacement !== placement_kind) {
      return new Response(
        JSON.stringify({
          error: placement_kind === "preorder"
            ? "The shop just closed for today. Refresh to pre-order for tomorrow."
            : "The shop is open now. Refresh to order for today.",
          code: "placement_changed",
        }),
        { status: 409 }
      );
    }

    const minAmt = Number(seller?.min_order_amount) || 0;
    if (minAmt > 0 && cartSubtotal < minAmt) {
      return new Response(
        JSON.stringify({ error: `Minimum order is ₹${minAmt}` }),
        { status: 400 }
      );
    }

    if (order_type === "delivery" && !seller?.has_delivery) {
      return new Response(JSON.stringify({ error: "Delivery isn't available for this shop" }), { status: 400 });
    }
    if (order_type === "pickup" && seller?.has_pickup === false) {
      return new Response(JSON.stringify({ error: "Pickup isn't available for this shop" }), { status: 400 });
    }
    const status: "pending_payment" = "pending_payment";

    // For per-km delivery fee: resolve buyer address coordinates once.
    let deliveryDistanceKm: number | undefined = undefined;
    const addr = await resolveOrderAddress(supabase, buyer_addr, buyer_id);
    if (!addr.ok) {
      return new Response(JSON.stringify({ error: addr.error }), { status: 400 });
    }
    const addrRow = addr.snapshot;
    if (order_type === "delivery" && seller?.lat != null && seller?.lng != null) {
      if (addrRow?.lat != null && addrRow?.lng != null) {
        deliveryDistanceKm = haversineKm(
          Number(seller.lat), Number(seller.lng),
          Number(addrRow.lat), Number(addrRow.lng)
        );
      }
    }

    // Fetch emails in parallel, non-blocking — resolved lazily when emails fire
    const buyerEmailPromise = buyer_id
      ? supabase.from("buyers").select("email").eq("id", buyer_id).single().then(r => r.data?.email || null).catch(() => null)
      : Promise.resolve(null);
    const sellerEmailPromise = clientSellerId
      ? supabase.from("sellers").select("email").eq("id", clientSellerId).single().then(r => r.data?.email || null).catch(() => null)
      : Promise.resolve(null);

    const orders: unknown[] = [];
    // Every row of this checkout shares one cart id: one payment, one notification,
    // one order for the seller (order-cart.ts, migration 078).
    const cart_id = crypto.randomUUID();
    const placed: { line: (typeof resolved)[number]["line"]; order: any }[] = [];
    // Rows already written for this cart. If a later line fails, cancel them so a
    // retry doesn't leave unpaid duplicates (which also count toward daily limits).
    const createdIds: string[] = [];
    const failCart = async (error: string, status: number) => {
      if (createdIds.length) {
        await supabase.from("orders")
          .update({ status: "cancelled", cancelled_by: "system", cancel_reason: "checkout_failed" })
          .in("id", createdIds);
      }
      return new Response(JSON.stringify({ error }), { status });
    };

    // Delivery fee applies once per cart, computed from the whole subtotal so it
    // matches what the buyer was shown (and honours free_delivery_above).
    const distErr = deliveryDistanceRejection(seller, order_type, deliveryDistanceKm);
    if (distErr) {
      return new Response(JSON.stringify({ error: distErr }), { status: 400 });
    }
    const cartDeliveryFee = seller ? computeDeliveryFee(seller, cartSubtotal, order_type, deliveryDistanceKm) : 0;
    let deliveryFeeAssigned = false;
    for (const { line } of resolved) {
      if (line.kind === "preorder") {
        // One delivery per cart: pre-order lines carry the fee too (first row only),
        // same as same-day lines and as /api/orders/create. It was hard-coded to 0,
        // so the same pre-order cost less through the cart than through create.
        const preFee = deliveryFeeAssigned ? 0 : cartDeliveryFee;
        deliveryFeeAssigned = true;
        const amountDue = line.total_price + preFee;
        const { data: preOrder, error: preErr } = await supabase
          .from("orders")
          .insert({
            listing_id: line.listing_id,
            species: line.species,
            buyer_phone,
            buyer_id: buyer_id || null,
            buyer_addr: buyer_addr || null,
            quantity: line.quantity,
            quantity_unit: line.quantity_unit,
            total_price: line.total_price,
            delivery_fee: preFee,
            platform_fee: 0,
            status: "pending_payment",
            placement_kind: "preorder",
            order_type,
            paid_amount: amountDue,
            pricing_option_id: line.pricing_option_id,
            pricing_label: line.pricing_label,
            is_preorder: true,
            ...slotCols,
            ...(buyer_notes ? { buyer_notes: String(buyer_notes).slice(0, 500) } : {}),
            ...(cut_style ? { cut_style: String(cut_style).slice(0, 50) } : {}),
          })
          .select()
          .single();

        if (preErr) {
          return failCart(preErr.message, 500);
        }
        createdIds.push(preOrder.id);
        orders.push(preOrder);
        placed.push({ line, order: preOrder });
        continue;
      }

      // BUG-40: this used to be computeDeliveryFee(seller, line.total_price, ...)
      // inside the per-line loop. A cart splits into one order row per line and
      // each row is paid separately, so a 3-line cart was charged the delivery
      // fee three times. computeDeliveryFee's parameter is even named `subtotal`
      // — it always wanted the cart total.
      //
      // Worse with free_delivery_above: the client compares the whole subtotal
      // against the threshold and can display "FREE", while the server compared
      // each line individually and charged the fee on every one.
      //
      // The fee is a property of the delivery, not of the line, so it is
      // computed once from cartSubtotal and carried by the first row only.
      const delivery_fee = deliveryFeeAssigned ? 0 : cartDeliveryFee;
      deliveryFeeAssigned = true;

      const { data: orderId, error: rpcError } = await supabase.rpc("create_order_atomic", {
        p_listing_id: line.listing_id,
        p_species: line.species,
        p_quantity: line.quantity,
        p_quantity_unit: line.quantity_unit,
        p_buyer_phone: buyer_phone,
        p_buyer_id: buyer_id || null,
        p_buyer_addr: buyer_addr || null,
        p_total_price: line.total_price,
        p_delivery_fee: delivery_fee,
        p_status: status,
        p_order_type: order_type,
        p_scheduled_for: null,
        p_schedule_slot_id: null,
        p_pricing_option_id: line.pricing_option_id,
        p_pricing_label: line.pricing_label,
      });

      if (rpcError) {
        const msg = rpcError.message || "";
        const isStockError = msg.includes("in stock") || msg.includes("Listing not found");
        return failCart(msg, isStockError ? 400 : 500);
      }
      createdIds.push(orderId);

      const { data: fetchedOrder, error: fetchErr } = await supabase
        .from("orders")
        .select()
        .eq("id", orderId)
        .single();
      if (fetchErr) {
        return failCart(fetchErr.message, 500);
      }
      await supabase.from("orders").update({ placement_kind: "same_day", is_preorder: false, ...slotCols }).eq("id", orderId);
      orders.push(fetchedOrder);
      placed.push({ line, order: fetchedOrder });
    }

    await saveAddressSnapshot(supabase, (orders as any[]).map((o) => o?.id).filter(Boolean), addr.snapshot);

    // Campaign attribution (e.g. flyer QR) — best effort, never fails the order.
    const utmRow = pickUtm(utm);
    const prefs = pickPreferences(cut_style, buyer_notes);
    const orderIds = (orders as { id?: string }[]).map((o) => o?.id).filter(Boolean) as string[];
    // Separate writes: preferences are what the seller prepares and must never be lost because the
    // optional attribution columns (migration 075) are missing on a database.
    if (prefs && orderIds.length) {
      const { error: prefsErr } = await supabase.from("orders").update(prefs).in("id", orderIds);
      if (prefsErr) console.warn("[create-seller-cart] preferences save failed", { err: prefsErr.message });
    }
    if (utmRow && orderIds.length) {
      const { error: utmErr } = await supabase.from("orders").update(utmRow).in("id", orderIds);
      if (utmErr) console.warn("[create-seller-cart] utm save failed (is migration 075 applied?)", { err: utmErr.message });
    }

    if (orderIds.length) {
      const { error: cartErr } = await supabase.from("orders").update({ cart_id }).in("id", orderIds);
      if (cartErr) console.warn("[create-seller-cart] cart_id save failed (is migration 078 applied?)", { err: cartErr.message });
    }

    // ONE notification for the whole cart (it used to be one push + one email per item).
    const isPreorder = placement_kind === "preorder";
    const first = placed[0];
    const many = placed.length > 1;
    const label = many ? cartLabel(placed.map((x) => x.line.species)) : (first?.line.species || "Fish");
    const cartTotal = cartSubtotal + cartDeliveryFee;
    if (first) {
      try {
        await fetch(`${url.origin}/api/notify-seller`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...internalHeaders() },
          body: JSON.stringify({
            seller_id: first.line.seller_id,
            species: label,
            item_count: placed.length,
            quantity: first.line.quantity,
            quantity_unit: first.line.quantity_unit,
            placement_kind,
            amount: many ? cartTotal : null,
            buyer_phone,
            scheduled_for: scheduled_for || null,
            order_id: first.order.id,
          }),
        });
      } catch (err) {
        console.warn("[create-seller-cart] notify-seller failed", { err: (err as any)?.message });
      }
      if (buyer_id || buyer_phone) {
        afterResponse(sendBuyerOrderPush({
          buyer_id: buyer_id || null,
          buyer_phone,
          status: "placed",
          species: label,
          order_id: first.order.id,
        }), "create-seller-cart:buyer-push");
      }
      if (resendApiKey) {
        const statusLabel = isPreorder
          // A slot can be on a later delivery day than the next one (preorder_days_ahead).
          ? preorderPlacedLabel(slotCheck.slot ? slotDateIST(slotCheck.slot.start) : (resolved.find((x) => x.line.kind === "preorder")?.line as PreorderLinePayload | undefined)?.delivery_date)
          : scheduled_for
          ? "Pickup scheduled — complete payment to confirm 🗓️"
          : "Order placed — complete payment to confirm";
        afterResponse(Promise.all([buyerEmailPromise, sellerEmailPromise]).then(([bEmail, sEmail]) =>
          sendCartOrderEmail(resendApiKey, {
            order: first.order,
            species: label,
            quantity: first.line.quantity,
            quantity_unit: first.line.quantity_unit,
            total_price: cartSubtotal,
            delivery_fee: cartDeliveryFee,
            statusLabel,
            scheduled_for,
            buyerEmail: bEmail,
            buyer_phone,
            sellerEmail: sEmail,
            isPreorder,
            deliverySlot: slotCheck.slot ? slotLabel(slotCheck.slot.start, slotCheck.slot.end) : null,
            preorderMin: many ? null : first.line.preorder_price_min,
            preorderMax: many ? null : first.line.preorder_price_max,
            bundleSize: many ? null : (first.line as any).bundle_size || null,
            pricingLabel: many ? null : first.line.pricing_label || null,
            items: many ? placed.map(({ line }) => ({
              species: line.species || "Fish",
              quantity: line.quantity,
              quantity_unit: line.quantity_unit,
              total_price: line.total_price,
              pricingLabel: line.pricing_label || null,
              bundleSize: (line as any).bundle_size > 1 ? (line as any).bundle_size : null,
              bundleCount: (line as any).bundle_size > 1 ? Math.round(line.quantity / (line as any).bundle_size) : null,
              note: isPreorder && line.preorder_price_min && line.preorder_price_max && line.preorder_price_min !== line.preorder_price_max
                ? `est. ₹${line.preorder_price_min}–₹${line.preorder_price_max}` : null,
            })) : undefined,
          })
        ), "create-seller-cart:order-email");
      }
    }

    // Meta InitiateCheckout with the eventID the pixel used when checkout opened (Meta dedupes).
    // No id = internal device (rf_internal) or an old page; test buyers/sellers make is_test orders.
    if (typeof meta_event_id === "string" && meta_event_id && meta_event_id.length <= 64
        && placed.length && !placed.some((x) => x.order?.is_test)) {
      afterResponse(metaEvent("InitiateCheckout", meta_event_id, {
        value: cartSubtotal,
        contents: placed.map(({ line }) => ({ id: String(line.listing_id), quantity: Number(line.quantity) })),
        ...metaUserFromRequest(request),
        event_source_url: request.headers.get("referer")?.slice(0, 500) || undefined,
      }), "meta-capi:InitiateCheckout");
    }

    return new Response(JSON.stringify({ orders, cart_id, cart_subtotal: cartSubtotal, cart_total: cartTotal, placement_kind }), { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("create-seller-cart error:", err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

async function sendCartOrderEmail(
  apiKey: string,
  args: {
    order: { id?: string };
    species: string | null;
    quantity: number;
    quantity_unit: string;
    total_price: number;
    delivery_fee: number;
    statusLabel: string;
    scheduled_for: string | null | undefined;
    buyerEmail: string | null | undefined;
    buyer_phone: string;
    sellerEmail: string | null | undefined;
    isPreorder?: boolean;
    deliverySlot?: string | null;
    preorderMin?: number | null;
    preorderMax?: number | null;
    bundleSize?: number | null;
    pricingLabel?: string | null;
    items?: OrderEmailItem[];
  }
) {
  const {
    species, quantity, quantity_unit, total_price, delivery_fee,
    statusLabel, scheduled_for, buyerEmail, sellerEmail, buyer_phone,
    bundleSize, pricingLabel,
  } = args;
  const bs = bundleSize && bundleSize > 1 ? bundleSize : null;
  const bc = bs ? Math.round(quantity / bs) : null;
  const emailArgs = {
    statusLabel,
    species: species || "Fish",
    quantity,
    quantity_unit,
    totalAmount: total_price + delivery_fee,
    deliveryFee: delivery_fee,
    orderId: args.order?.id,
    scheduled_for: scheduled_for || null,
    isPreorder: args.isPreorder,
    deliverySlot: args.deliverySlot,
    preorderMin: args.preorderMin,
    preorderMax: args.preorderMax,
    bundleSize: bs,
    bundleCount: bc,
    pricingLabel: pricingLabel || null,
    items: args.items,
  };
  const speciesForEmail = capitalizeFishName(species || "Fish");
  const sellerSubject = args.isPreorder ? `New pre-order: ${speciesForEmail}` : `New order: ${speciesForEmail}`;
  // BUG-24 + BUG-27: awaited, and non-2xx from Resend is now logged instead of
  // being swallowed by `.catch(() => {})`.
  await Promise.allSettled([
    sendTransactionalEmail(buyerEmail, `${statusLabel} — ${speciesForEmail}`, orderEmailBuyer(emailArgs), "cart-buyer"),
    sendTransactionalEmail(sellerEmail, sellerSubject, orderEmailSeller({ ...emailArgs, buyerPhone: buyer_phone }), "cart-seller"),
  ]);
}

