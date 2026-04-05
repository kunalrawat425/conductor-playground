import type { APIRoute } from "astro";
import webPush from "web-push";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const vapidPublicKey = import.meta.env.PUBLIC_VAPID_KEY || "";
const vapidPrivateKey = import.meta.env.VAPID_PRIVATE_KEY || "";

if (vapidPublicKey && vapidPrivateKey) {
  webPush.setVapidDetails(
    "mailto:hello@taazi.in",
    vapidPublicKey,
    vapidPrivateKey
  );
}

/**
 * POST /api/push-notify
 * Called by Supabase Database Webhook when orders.status changes.
 * Body: { buyer_id, status, species, final_price }
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { buyer_id, status, species, final_price } = body;

    if (!buyer_id || !status) {
      return new Response(JSON.stringify({ error: "Missing buyer_id or status" }), {
        status: 400,
      });
    }

    // Get buyer's push subscription
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: buyer } = await supabase
      .from("buyers")
      .select("push_subscription, push_enabled")
      .eq("id", buyer_id)
      .single();

    if (!buyer?.push_enabled || !buyer?.push_subscription) {
      return new Response(JSON.stringify({ skipped: true, reason: "push not enabled" }), {
        status: 200,
      });
    }

    // Build notification message
    const messages: Record<string, { title: string; body: string }> = {
      confirmed: {
        title: "Order Confirmed!",
        body: species
          ? final_price
            ? `Your ${species} order confirmed at ₹${final_price}`
            : `Your ${species} order is confirmed`
          : "Your order has been confirmed",
      },
      picked_up: {
        title: "Ready for Pickup!",
        body: species
          ? `Your ${species} is ready for pickup`
          : "Your order is ready for pickup",
      },
      declined: {
        title: "Order Update",
        body: species
          ? `Sorry, your ${species} order was declined`
          : "Your order was declined",
      },
      cancelled: {
        title: "Order Cancelled",
        body: species
          ? `Your ${species} order was cancelled. Full refund processing.`
          : "Your order was cancelled. Full refund processing.",
      },
    };

    const notification = messages[status] || {
      title: "Order Update",
      body: `Your order status: ${status}`,
    };

    await webPush.sendNotification(
      buyer.push_subscription,
      JSON.stringify({
        ...notification,
        url: "/track",
        tag: `order-${buyer_id}-${status}`,
      })
    );

    return new Response(JSON.stringify({ sent: true }), { status: 200 });
  } catch (err: any) {
    console.error("Push notify error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500 }
    );
  }
};
