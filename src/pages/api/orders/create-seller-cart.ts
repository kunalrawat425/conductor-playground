import type { APIRoute } from "astro";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeDeliveryFee, haversineKm } from "../../../lib/order-pricing";
import {
  capitalizeFishName,
  orderEmailBuyer,
  orderEmailSeller,
  type OrderEmailArgs,
} from "../../../lib/email-templates";
import { getListingOptionById, type ListingPricingSource } from "../../../lib/listing-pricing";
import type { PlacementKind } from "../../../lib/order-timing";
import { sendBuyerOrderPush } from "../../../lib/server/buyer-push";
import { resolveListingOrderLine } from "../../../lib/server/resolve-listing-order-line";
import { internalHeaders } from "../../../lib/server/internal-auth";

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
    const {
      lines: rawLines,
      buyer_phone,
      buyer_id,
      buyer_addr,
      order_type = "pickup",
      seller_id: clientSellerId,
      scheduled_for,
      buyer_notes,
      cut_style,
    } = body;

    if (scheduled_for) {
      return new Response(
        JSON.stringify({ error: "Scheduled pickup slots are not available. Order for now or during pre-order hours." }),
        { status: 400 }
      );
    }

    if (!buyer_phone) {
      return new Response(JSON.stringify({ error: "Phone number required" }), { status: 400 });
    }
    if (!clientSellerId || typeof clientSellerId !== "string") {
      return new Response(JSON.stringify({ error: "seller_id required" }), { status: 400 });
    }
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      return new Response(JSON.stringify({ error: "lines array required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const resolved: ResolvedRow[] = [];

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
      });
      if (!r.ok) {
        return new Response(JSON.stringify({ error: r.error }), { status: r.status });
      }
      if (r.line.seller_id !== clientSellerId) {
        return new Response(JSON.stringify({ error: "All items must be from the same seller" }), { status: 400 });
      }
      resolved.push({ line: r.line });
    }

    const cartSubtotal = resolved.reduce((s, x) => s + x.line.total_price, 0);
    const placement_kind: PlacementKind = resolved.some((x) => x.line.placement_kind === "preorder")
      ? "preorder"
      : "same_day";

    const { data: seller } = await supabase
      .from("sellers")
      .select(
        "opens_at, closes_at, accepts_preorder, has_delivery, has_pickup, min_order_amount, delivery_fee_enabled, delivery_fee_amount, delivery_fee_type, delivery_fee_per_km, free_delivery_above, lat, lng"
      )
      .eq("id", clientSellerId)
      .single();

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
    if (order_type === "pickup" && seller?.has_pickup === false) {
      return new Response(JSON.stringify({ error: "This seller does not offer pickup" }), { status: 400 });
    }

    const status: "pending_payment" = "pending_payment";

    // For per-km delivery fee: resolve buyer address coordinates once.
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

    // Fetch emails in parallel, non-blocking — resolved lazily when emails fire
    const buyerEmailPromise = buyer_id
      ? supabase.from("buyers").select("email").eq("id", buyer_id).single().then(r => r.data?.email || null).catch(() => null)
      : Promise.resolve(null);
    const sellerEmailPromise = clientSellerId
      ? supabase.from("sellers").select("email").eq("id", clientSellerId).single().then(r => r.data?.email || null).catch(() => null)
      : Promise.resolve(null);

    const orders: unknown[] = [];

    for (const { line } of resolved) {
      if (line.kind === "preorder") {
        const amountDue = line.total_price;
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
            delivery_fee: 0,
            platform_fee: 0,
            status: "pending_payment",
            placement_kind: "preorder",
            order_type,
            payment_type: "cod",
            paid_amount: amountDue,
            pricing_option_id: line.pricing_option_id,
            pricing_label: line.pricing_label,
            is_preorder: true,
            ...(buyer_notes ? { buyer_notes: String(buyer_notes).slice(0, 500) } : {}),
            ...(cut_style ? { cut_style: String(cut_style).slice(0, 50) } : {}),
          })
          .select()
          .single();

        if (preErr) {
          return new Response(JSON.stringify({ error: preErr.message }), { status: 500 });
        }
        orders.push(preOrder);

        try {
          const origin = url.origin;
          await fetch(`${origin}/api/notify-seller`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...internalHeaders() },
            body: JSON.stringify({
              seller_id: line.seller_id,
              species: line.species || "Fish",
              quantity: line.quantity,
              quantity_unit: line.quantity_unit,
              buyer_phone,
              scheduled_for: scheduled_for || null,
              order_id: preOrder.id,
            }),
          });
        } catch {
          /* non-blocking */
        }

        if (preOrder?.id) {
          try {
            await sendBuyerOrderPush({
              buyer_id: buyer_id || null,
              buyer_phone,
              status: "placed",
              species: line.species || "Fish",
              order_id: preOrder.id,
            });
          } catch {
            /* non-blocking */
          }
        }

        if (resendApiKey && preOrder) {
          const _po = preOrder;
          Promise.all([buyerEmailPromise, sellerEmailPromise]).then(([bEmail, sEmail]) => {
            sendCartOrderEmail(resendApiKey, {
              order: _po,
              species: line.species,
              quantity: line.quantity,
              quantity_unit: line.quantity_unit,
              total_price: line.total_price,
              delivery_fee: 0,
              statusLabel: "Pre-order placed — catch reserved for tomorrow",
              scheduled_for,
              buyer_phone,
              buyerEmail: bEmail,
              sellerEmail: sEmail,
              isPreorder: true,
              preorderMin: line.preorder_price_min,
              preorderMax: line.preorder_price_max,
              bundleSize: (line as any).bundle_size || null,
              pricingLabel: line.pricing_label || null,
            });
          }).catch(() => {});
        }
        continue;
      }

      const delivery_fee = seller ? computeDeliveryFee(seller, line.total_price, order_type, deliveryDistanceKm) : 0;

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
        return new Response(JSON.stringify({ error: msg }), { status: isStockError ? 400 : 500 });
      }

      const { data: fetchedOrder, error: fetchErr } = await supabase
        .from("orders")
        .select()
        .eq("id", orderId)
        .single();
      if (fetchErr) {
        return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
      }
      await supabase.from("orders").update({ placement_kind: "same_day", is_preorder: false }).eq("id", orderId);
      orders.push(fetchedOrder);

      try {
        const origin = url.origin;
        await fetch(`${origin}/api/notify-seller`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...internalHeaders() },
          body: JSON.stringify({
            seller_id: line.seller_id,
            species: line.species || "Fish",
            quantity: line.quantity,
            quantity_unit: line.quantity_unit,
            buyer_phone,
            scheduled_for: scheduled_for || null,
            order_id: fetchedOrder.id,
          }),
        });
      } catch {
        /* non-blocking */
      }

      if (fetchedOrder?.id && (fetchedOrder.buyer_id || buyer_phone)) {
        sendBuyerOrderPush({
          buyer_id: fetchedOrder.buyer_id,
          buyer_phone,
          status: "placed",
          species: line.species || "Fish",
          order_id: fetchedOrder.id,
        }).catch(() => {});
      }

      if (resendApiKey && fetchedOrder) {
        const RAZORPAY_ENABLED = import.meta.env.PUBLIC_ENABLE_RAZORPAY === "true";
        const stLabel =
          scheduled_for
            ? "Pickup scheduled — complete payment to confirm 🗓️"
            : RAZORPAY_ENABLED
              ? "Order placed — complete payment to confirm"
              : "Order placed — upload payment proof";
        const _fo = fetchedOrder;
        Promise.all([buyerEmailPromise, sellerEmailPromise]).then(([bEmail, sEmail]) => {
          sendCartOrderEmail(resendApiKey, {
            order: _fo,
            species: line.species,
            quantity: line.quantity,
            quantity_unit: line.quantity_unit,
            total_price: line.total_price,
            delivery_fee,
            statusLabel: stLabel,
            scheduled_for,
            buyerEmail: bEmail,
            buyer_phone,
            sellerEmail: sEmail,
            bundleSize: (line as any).bundle_size || null,
            pricingLabel: line.pricing_label || null,
          });
        }).catch(() => {});
      }
    }

    return new Response(JSON.stringify({ orders, cart_subtotal: cartSubtotal, placement_kind }), { status: 201 });
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
    preorderMin?: number | null;
    preorderMax?: number | null;
    bundleSize?: number | null;
    pricingLabel?: string | null;
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
    preorderMin: args.preorderMin,
    preorderMax: args.preorderMax,
    bundleSize: bs,
    bundleCount: bc,
    pricingLabel: pricingLabel || null,
  };
  const speciesForEmail = capitalizeFishName(species || "Fish");
  const sellerSubject = args.isPreorder ? `New pre-order: ${speciesForEmail}` : `New order: ${speciesForEmail}`;
  if (buyerEmail) {
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Relifish <noreply@relifish.store>",
        to: buyerEmail,
        subject: `${statusLabel} — ${speciesForEmail}`,
        html: orderEmailBuyer(emailArgs),
      }),
    }).catch(() => {});
  }
  if (sellerEmail) {
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Relifish <noreply@relifish.store>",
        to: sellerEmail,
        subject: sellerSubject,
        html: orderEmailSeller({ ...emailArgs, buyerPhone: buyer_phone }),
      }),
    }).catch(() => {});
  }
}
