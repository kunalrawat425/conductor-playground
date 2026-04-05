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
 * POST /api/notify-seller
 * Body: { seller_id, species, quantity, quantity_unit, buyer_phone }
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { seller_id, species, quantity, quantity_unit, buyer_phone } = await request.json();

    if (!seller_id) {
      return new Response(JSON.stringify({ error: "Missing seller_id" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: seller } = await supabase
      .from("sellers")
      .select("push_subscription, push_enabled, name")
      .eq("id", seller_id)
      .single();

    if (!seller?.push_enabled || !seller?.push_subscription) {
      return new Response(JSON.stringify({ skipped: true, reason: "push not enabled" }), { status: 200 });
    }

    const unitLabel = quantity_unit === "dozen" ? "dz" : quantity_unit || "kg";
    const body = species
      ? `New order: ${species} ${quantity || ""}${unitLabel} from ${buyer_phone || "a buyer"}`
      : `You have a new order from ${buyer_phone || "a buyer"}`;

    await webPush.sendNotification(
      seller.push_subscription,
      JSON.stringify({
        title: "New Order!",
        body,
        url: "/dashboard",
        tag: `seller-order-${Date.now()}`,
      })
    );

    return new Response(JSON.stringify({ sent: true }), { status: 200 });
  } catch (err: any) {
    console.error("Seller notify error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
