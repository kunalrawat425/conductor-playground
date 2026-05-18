import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { computeDeliveryFee } from "../../../lib/order-pricing";
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

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

async function patchPlacementKind(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
  placement_kind: PlacementKind
) {
  await supabase.from("orders").update({ placement_kind }).eq("id", orderId);
}

async function sendOrderEmails(
  supabase: ReturnType<typeof createClient>,
  args: {
    placement_kind: PlacementKind;
    species: string;
    emailArgs: OrderEmailArgs;
    buyer_id?: string | null;
    seller_id: string | null;
  }
) {
  if (!resendApiKey) return;
  const { placement_kind, species, emailArgs, buyer_id, seller_id } = args;
  const speciesForEmail = capitalizeFishName(species);
  const subjectPrefix =
    placement_kind === "preorder" ? "Pre-order placed" : emailArgs.statusLabel;

  if (buyer_id) {
    const { data: buyer } = await supabase.from("buyers").select("email").eq("id", buyer_id).single();
    if (buyer?.email) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Relifish <noreply@relifish.store>",
          to: buyer.email,
          subject: `${subjectPrefix} — ${speciesForEmail}`,
          html: orderEmailBuyer(emailArgs),
        }),
      });
    }
  }
  if (seller_id) {
    const { data: sellerData } = await supabase.from("sellers").select("email").eq("id", seller_id).single();
    if (sellerData?.email) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Relifish <noreply@relifish.store>",
          to: sellerData.email,
          subject:
            placement_kind === "preorder"
              ? `New pre-order: ${speciesForEmail}`
              : `New order: ${speciesForEmail}`,
          html: orderEmailSeller(emailArgs),
        }),
      });
    }
  }
}

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
        const delivery_fee = 0;
        const amountDue = total_price + delivery_fee;
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
            delivery_fee,
            platform_fee: 0,
            status: "pending_payment",
            placement_kind: "preorder",
            order_type,
            payment_type: "cod",
            paid_amount: amountDue,
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
          try {
            await fetch(`${url.origin}/api/notify-seller`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                seller_id,
                species: species || "Fish",
                quantity,
                quantity_unit,
                placement_kind: "preorder",
                order_id: preOrder.id,
              }),
            });
          } catch {
            /* non-blocking */
          }
        }

        if (preOrder?.id) {
          try {
            await sendBuyerOrderPush({
              buyer_id: buyer_id || null,
              buyer_phone,
              status: "placed",
              species: species || "Fish",
              order_id: preOrder.id,
            });
          } catch {
            /* non-blocking */
          }
        }

        const chosen = getListingOptionById(
          { pricing_options: listingPricingOptions } as ListingPricingSource,
          orderPricingOptionId
        );
        const emailArgs: OrderEmailArgs = {
          statusLabel: "Pre-order placed — upload payment proof",
          species: species || "Fish",
          quantity,
          quantity_unit,
          totalAmount: amountDue,
          deliveryFee: delivery_fee,
          orderId: preOrder.id,
          pricing_option_id: orderPricingOptionId,
          pricing_label: orderPricingLabel,
          pricing_options: listingPricingOptions,
          bundle_size: chosen?.bundle_size,
          buyerNotes: buyer_notes ? String(buyer_notes).slice(0, 500) : null,
          cutStyle: cut_style ? String(cut_style).slice(0, 50) : null,
        };
        await sendOrderEmails(supabase, {
          placement_kind: "preorder",
          species: species || "Fish",
          emailArgs,
          buyer_id,
          seller_id,
        });

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

    const status = "pending_payment";
    let delivery_fee = 0;

    if (seller_id) {
      const { data: seller } = await supabase
        .from("sellers")
        .select(
          "opens_at, closes_at, accepts_preorder, has_delivery, has_pickup, min_order_amount, delivery_fee_enabled, delivery_fee_amount, free_delivery_above, preorder_cutoff_time, open_days, preorder_days"
        )
        .eq("id", seller_id)
        .single();

      const placement = seller ? classifyPlacementAtOrderTime(seller) : "same_day";
      if (placement === "closed") {
        return new Response(JSON.stringify({ error: closedSellerMessage(seller!) }), { status: 400 });
      }
      placement_kind = placement;

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

      delivery_fee = seller ? computeDeliveryFee(seller, total_price, order_type) : 0;
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
      await patchPlacementKind(supabase, orderId, placement_kind);
    }

    if (!order) {
      return new Response(JSON.stringify({ error: "Order creation failed" }), { status: 500 });
    }

    if (seller_id) {
      try {
        await fetch(`${url.origin}/api/notify-seller`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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

    const chosen = listing_id
      ? getListingOptionById(
          { pricing_options: listingPricingOptions } as ListingPricingSource,
          orderPricingOptionId
        )
      : null;
    const emailArgs: OrderEmailArgs = {
      statusLabel: "Order placed — upload payment proof",
      species: species || "Fish",
      quantity,
      quantity_unit,
      totalAmount: total_price + delivery_fee,
      deliveryFee: delivery_fee,
      orderId: order.id,
      pricing_option_id: orderPricingOptionId,
      pricing_label: orderPricingLabel,
      pricing_options: listingPricingOptions,
      bundle_size: chosen?.bundle_size,
      buyerNotes: buyer_notes ? String(buyer_notes).slice(0, 500) : null,
      cutStyle: cut_style ? String(cut_style).slice(0, 50) : null,
    };
    await sendOrderEmails(supabase, {
      placement_kind,
      species: species || "Fish",
      emailArgs,
      buyer_id,
      seller_id,
    });

    return new Response(JSON.stringify({ order, placement_kind }), { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Order create error:", err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
