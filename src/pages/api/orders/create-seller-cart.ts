import type { APIRoute } from "astro";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeDeliveryFee } from "../../../lib/order-pricing";
import { resolveListingOrderLine } from "../../../lib/server/resolve-listing-order-line";
import type { OosPreorderLinePayload, StandardOrderLinePayload } from "../../../lib/server/resolve-listing-order-line";

type ResolvedRow = { line: StandardOrderLinePayload | OosPreorderLinePayload };

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

type CartLineInput = {
  listing_id: string;
  quantity: number;
  quantity_unit?: string;
  pricing_option_id?: string | null;
  species?: string | null;
};

/**
 * POST /api/orders/create-seller-cart
 * Multi-line checkout for one seller: validates minimum order against cart subtotal (not each line).
 * Body: { seller_id, lines: CartLineInput[], buyer_phone, buyer_id?, buyer_addr?, order_type?, scheduled_for?, schedule_slot_id? }
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
      schedule_slot_id,
    } = body;

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
        scheduled_for: scheduled_for || null,
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

    const { data: seller } = await supabase
      .from("sellers")
      .select(
        "opens_at, closes_at, accepts_preorder, has_delivery, min_order_amount, delivery_fee_enabled, delivery_fee_amount, free_delivery_above, schedule_pickup_slots"
      )
      .eq("id", clientSellerId)
      .single();

    if (scheduled_for && !seller) {
      return new Response(JSON.stringify({ error: "Scheduled orders require a seller." }), { status: 400 });
    }
    if (scheduled_for && !seller?.schedule_pickup_slots) {
      return new Response(JSON.stringify({ error: "Pickup scheduling is not available for this seller." }), { status: 400 });
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

    let status: "pending" | "pre_order" | "scheduled" = "pending";
    if (scheduled_for) {
      status = "scheduled";
    } else if (seller && !isSellerCurrentlyOpen(seller.opens_at, seller.closes_at)) {
      status = "pre_order";
    }

    const orders: unknown[] = [];

    for (const { line } of resolved) {
      if (line.kind === "oos_preorder") {
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
            status: "pre_order",
            order_type,
            payment_type: "cod",
            paid_amount: amountDue,
            scheduled_for: scheduled_for || null,
            schedule_slot_id: schedule_slot_id || null,
            pricing_option_id: line.pricing_option_id,
            pricing_label: line.pricing_label,
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
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              seller_id: line.seller_id,
              species: line.species || "Fish",
              quantity: line.quantity,
              quantity_unit: line.quantity_unit,
              buyer_phone,
              scheduled_for: scheduled_for || null,
            }),
          });
        } catch {
          /* non-blocking */
        }

        if (resendApiKey && preOrder) {
          try {
            await sendOrderEmail(supabase, resendApiKey, {
              order: preOrder,
              species: line.species,
              quantity: line.quantity,
              quantity_unit: line.quantity_unit,
              total_price: line.total_price,
              delivery_fee: 0,
              statusLabel: "Pre-order Placed",
              scheduled_for,
              buyer_id,
              buyer_phone,
              seller_id: line.seller_id,
            });
          } catch {
            /* non-blocking */
          }
        }
        continue;
      }

      const delivery_fee = seller ? computeDeliveryFee(seller, line.total_price, order_type) : 0;

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
        p_scheduled_for: scheduled_for || null,
        p_schedule_slot_id: schedule_slot_id || null,
        p_pricing_option_id: line.pricing_option_id,
        p_pricing_label: line.pricing_label,
      });

      if (rpcError) {
        const msg = rpcError.message || "";
        const isStockError = msg.includes("in stock") || msg.includes("Listing not found");
        return new Response(JSON.stringify({ error: msg }), { status: isStockError ? 400 : 500 });
      }

      const { data: fetchedOrder, error: fetchErr } = await supabase.from("orders").select().eq("id", orderId).single();
      if (fetchErr) {
        return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
      }
      orders.push(fetchedOrder);

      try {
        const origin = url.origin;
        await fetch(`${origin}/api/notify-seller`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            seller_id: line.seller_id,
            species: line.species || "Fish",
            quantity: line.quantity,
            quantity_unit: line.quantity_unit,
            buyer_phone,
            scheduled_for: scheduled_for || null,
          }),
        });
      } catch {
        /* non-blocking */
      }

      if (resendApiKey && fetchedOrder) {
        const stLabel =
          status === "scheduled" ? "Order Scheduled 🗓️" : status === "pre_order" ? "Pre-order Placed" : "Order Placed";
        try {
          await sendOrderEmail(supabase, resendApiKey, {
            order: fetchedOrder,
            species: line.species,
            quantity: line.quantity,
            quantity_unit: line.quantity_unit,
            total_price: line.total_price,
            delivery_fee,
            statusLabel: stLabel,
            scheduled_for,
            buyer_id,
            buyer_phone,
            seller_id: line.seller_id,
          });
        } catch {
          /* non-blocking */
        }
      }
    }

    return new Response(JSON.stringify({ orders, cart_subtotal: cartSubtotal }), { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("create-seller-cart error:", err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

async function sendOrderEmail(
  supabase: SupabaseClient,
  resendApiKey: string,
  args: {
    order: { id?: string };
    species: string | null;
    quantity: number;
    quantity_unit: string;
    total_price: number;
    delivery_fee: number;
    statusLabel: string;
    scheduled_for: string | null | undefined;
    buyer_id: string | null | undefined;
    buyer_phone: string;
    seller_id: string;
  }
) {
  const {
    species,
    quantity,
    quantity_unit,
    total_price,
    delivery_fee,
    statusLabel,
    scheduled_for,
    buyer_id,
    buyer_phone,
    seller_id,
  } = args;
  const schedText = scheduled_for
    ? `<p style="color:#1565c0;font-weight:600;">🗓️ Scheduled: ${new Date(scheduled_for).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} at ${new Date(scheduled_for).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>`
    : "";
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
  if (buyer_id) {
    const { data: buyer } = await supabase.from("buyers").select("email").eq("id", buyer_id).single();
    if (buyer?.email) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Relifish <onboarding@resend.dev>",
          to: buyer.email,
          subject: `${statusLabel} — ${species || "Fish"}`,
          html: emailBody,
        }),
      });
    }
  }
  const { data: sellerData } = await supabase.from("sellers").select("email").eq("id", seller_id).single();
  if (sellerData?.email) {
    const sellerEmail = emailBody.replace("Track Order", "View Orders").replace("/track", "/dashboard/orders");
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Relifish <onboarding@resend.dev>",
        to: sellerData.email,
        subject: `New Order: ${species || "Fish"} — ${buyer_phone}`,
        html: sellerEmail,
      }),
    });
  }
}
