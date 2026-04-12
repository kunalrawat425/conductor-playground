import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { sendBuyerOrderPush } from "../../../lib/server/buyer-push";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

const STATUS_LABELS: Record<string, string> = {
  pending: "Order Placed",
  confirmed: "Order Confirmed",
  paid: "Payment Received",
  picked_up: "Ready for Pickup",
  completed: "Order Completed",
  declined: "Order Declined",
  cancelled: "Order Cancelled",
  refunded: "Refund Processed",
  scheduled: "Order Scheduled",
  pre_order: "Pre-order Placed",
};

async function sendOrderEmail(to: string, subject: string, bodyHtml: string) {
  if (!resendApiKey || !to || !to.includes("@")) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Relifish <onboarding@resend.dev>", to, subject, html: bodyHtml }),
    });
  } catch (_) {}
}

/**
 * POST /api/seller/orders
 * Body: { seller_id, order_id, status, final_price? }
 * Uses service_role key to bypass RLS
 * Notifies buyer via push when status changes
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { seller_id, order_id, status, final_price } = await request.json();

    if (!seller_id || !order_id || !status) {
      return new Response(JSON.stringify({ error: "seller_id, order_id, and status required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify order belongs to this seller's listings
    const { data: order } = await supabase
      .from("orders")
      .select("listing_id, buyer_id, species")
      .eq("id", order_id)
      .single();

    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
    }

    if (order.listing_id) {
      const { data: listing } = await supabase
        .from("fish_listings")
        .select("seller_id")
        .eq("id", order.listing_id)
        .single();

      if (!listing || listing.seller_id !== seller_id) {
        return new Response(JSON.stringify({ error: "Not your order" }), { status: 403 });
      }
    }

    const updates: any = { status };
    if (final_price !== undefined) {
      updates.final_price = final_price;
      // When seller sets final_price on a pre-order, keep as pre_order
      // Buyer must accept before it becomes confirmed
      if (status === "confirmed") {
        // Check if this was a pre-order — if so, keep status as pre_order
        const { data: currentOrder } = await supabase.from("orders").select("status").eq("id", order_id).single();
        if (currentOrder?.status === "pre_order") {
          updates.status = "pre_order"; // Stay as pre_order until buyer accepts
        }
      }
    }
    if (status === "declined" || status === "cancelled") {
      updates.cancelled_by = "seller";
    }

    const { data, error } = await supabase
      .from("orders")
      .update(updates)
      .eq("id", order_id)
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    // Notify buyer via push — never fail the order update if push throws
    if (order.buyer_id) {
      try {
        const pushResult = await sendBuyerOrderPush({
          buyer_id: order.buyer_id,
          status,
          species: order.species || "Fish",
          final_price: final_price ?? null,
        });
        if (!pushResult.ok) {
          console.error("Buyer push failed:", pushResult.error);
        } else if (!pushResult.sent) {
          console.info("Buyer push skipped:", pushResult.reason);
        }
      } catch (pushErr: any) {
        console.error("Buyer push exception:", pushErr?.message || pushErr);
      }
    }

    // Send email notifications to buyer and seller
    try {
      const statusLabel = STATUS_LABELS[status] || status;
      const species = order.species || "Fish";
      const priceText = final_price ? `₹${final_price}` : data.total_price ? `₹${data.total_price}` : "";
      const schedText = data.scheduled_for ? `<p style="color:#1565c0;font-weight:600;">🗓️ Scheduled: ${new Date(data.scheduled_for).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} at ${new Date(data.scheduled_for).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</p>` : "";

      const emailBody = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h1 style="font-size:20px;margin:0 0 12px;">🐟 ${statusLabel}</h1>
          <div style="background:#f8f9fa;border-radius:12px;padding:16px;margin:0 0 16px;">
            <p style="margin:0 0 8px;font-size:15px;"><strong>${species}</strong> ${data.quantity ? `· ${data.quantity} ${data.quantity_unit}` : ""}</p>
            ${priceText ? `<p style="margin:0 0 8px;font-size:15px;font-weight:600;">${priceText}</p>` : ""}
            ${schedText}
            <p style="margin:0;font-size:13px;color:#666;">Order #${order_id.substring(0, 8)}</p>
          </div>
          <a href="https://www.relifish.store/track" style="display:inline-block;background:#0066cc;color:white;padding:10px 24px;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px;">Track Order</a>
          <p style="font-size:12px;color:#999;margin:16px 0 0;">— Team Relifish</p>
        </div>
      `;

      // Email buyer (if they have email)
      if (order.buyer_id) {
        const { data: buyer } = await supabase.from("buyers").select("email").eq("id", order.buyer_id).single();
        if (buyer?.email) {
          await sendOrderEmail(buyer.email, `${statusLabel} — ${species}`, emailBody);
        }
      }

      // Email seller
      const { data: seller } = await supabase.from("sellers").select("email").eq("id", seller_id).single();
      if (seller?.email) {
        const sellerBody = emailBody.replace("Track Order", "View Orders").replace("/track", "/dashboard/orders");
        await sendOrderEmail(seller.email, `Order Update: ${statusLabel} — ${species}`, sellerBody);
      }
    } catch (_) {}

    return new Response(JSON.stringify({ order: data }), { status: 200 });
  } catch (err: any) {
    console.error("Seller orders error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
