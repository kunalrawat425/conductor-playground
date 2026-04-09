import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { priceUnitShortLabel } from "../../lib/listing-pricing";
import type { PriceUnit } from "../../lib/species";
import { loadWebPush } from "../../lib/server/load-web-push";
import { normalizeVapidKeyForWebPush, trimVapidKey } from "../../lib/server/vapid-env";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

const vapidPublicKey = normalizeVapidKeyForWebPush(import.meta.env.PUBLIC_VAPID_KEY || "");
const vapidPrivateKey = normalizeVapidKeyForWebPush(import.meta.env.VAPID_PRIVATE_KEY || "");
const vapidContact = trimVapidKey(import.meta.env.VAPID_CONTACT || "") || "mailto:hello@zepto.in";

/**
 * POST /api/notify-seller
 * Body: { seller_id, species, quantity, quantity_unit, buyer_phone }
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { seller_id, species, quantity, quantity_unit, buyer_phone, scheduled_for } = await request.json();

    if (!seller_id) {
      return new Response(JSON.stringify({ error: "Missing seller_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: seller } = await supabase
      .from("sellers")
      .select("push_subscription, push_enabled, name")
      .eq("id", seller_id)
      .single();

    if (!seller?.push_enabled || !seller?.push_subscription) {
      return new Response(JSON.stringify({ skipped: true, reason: "push not enabled" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error("notify-seller: VAPID keys not configured");
      return new Response(JSON.stringify({ skipped: true, reason: "vapid not configured" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const u = String(quantity_unit || "piece");
    const unitLabel =
      u === "piece" || u === "kg" || u === "gram"
        ? priceUnitShortLabel(u as PriceUnit)
        : u;
    const schedLabel = scheduled_for ? ` (Scheduled: ${new Date(scheduled_for).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})` : "";
    const body = species
      ? `New${scheduled_for ? " scheduled" : ""} order: ${species} ${quantity || ""}${unitLabel} from ${buyer_phone || "a buyer"}${schedLabel}`
      : `You have a new${scheduled_for ? " scheduled" : ""} order from ${buyer_phone || "a buyer"}${schedLabel}`;

    try {
      const webPush = await loadWebPush();
      webPush.setVapidDetails(vapidContact, vapidPublicKey, vapidPrivateKey);
      await webPush.sendNotification(
        seller.push_subscription,
        JSON.stringify({
          title: scheduled_for ? "New Scheduled Order! 🗓️" : "New Order!",
          body,
          url: "/dashboard/orders",
          tag: `seller-order-${Date.now()}`,
        })
      );
    } catch (pushErr: any) {
      console.error("notify-seller push failed:", pushErr?.message || pushErr);
      return new Response(JSON.stringify({ skipped: true, reason: pushErr?.message || "push failed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Seller notify error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
