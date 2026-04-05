import { createClient } from "@supabase/supabase-js";
import { loadWebPush } from "./load-web-push";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const vapidPublicKey = import.meta.env.PUBLIC_VAPID_KEY || "";
const vapidPrivateKey = import.meta.env.VAPID_PRIVATE_KEY || "";
/** mailto: or https: URL required by web-push (see VAPID_CONTACT in .env.example) */
const vapidContact = import.meta.env.VAPID_CONTACT || "mailto:hello@zepto.in";

export type BuyerPushPayload = {
  buyer_id: string;
  status: string;
  species?: string | null;
  final_price?: number | null;
};

export type BuyerPushResult =
  | { ok: true; sent: true }
  | { ok: true; sent: false; reason: string }
  | { ok: false; error: string };

function normalizeSubscription(raw: unknown): PushSubscriptionJSON | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as PushSubscriptionJSON;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && raw !== null && "endpoint" in raw) {
    return raw as PushSubscriptionJSON;
  }
  return null;
}

/**
 * Send a Web Push to the buyer for an order status change.
 * Shared by /api/push-notify (manual/test) and /api/seller/orders (no HTTP self-call).
 */
export async function sendBuyerOrderPush(payload: BuyerPushPayload): Promise<BuyerPushResult> {
  const { buyer_id, status, species, final_price } = payload;

  if (!buyer_id || !status) {
    return { ok: false, error: "Missing buyer_id or status" };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: buyer } = await supabase
    .from("buyers")
    .select("push_subscription, push_enabled")
    .eq("id", buyer_id)
    .single();

  const subscription = normalizeSubscription(buyer?.push_subscription);
  if (!subscription?.endpoint) {
    return {
      ok: true,
      sent: false,
      reason:
        "no push subscription — open /me, tap the bell, allow notifications, then try again",
    };
  }

  // Send if we have keys on file; heal push_enabled when a subscription exists but the flag was false
  if (!buyer?.push_enabled) {
    await supabase.from("buyers").update({ push_enabled: true }).eq("id", buyer_id);
  }

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error("buyer-push: VAPID keys not configured");
    return { ok: false, error: "VAPID keys not configured" };
  }

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
      body: species ? `Your ${species} is ready for pickup` : "Your order is ready for pickup",
    },
    declined: {
      title: "Order Update",
      body: species ? `Sorry, your ${species} order was declined` : "Your order was declined",
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

  const webPush = await loadWebPush();
  webPush.setVapidDetails(vapidContact, vapidPublicKey, vapidPrivateKey);

  try {
    await webPush.sendNotification(
      subscription,
      JSON.stringify({
        ...notification,
        url: "/track",
        tag: `order-${buyer_id}-${status}`,
      })
    );
    return { ok: true, sent: true };
  } catch (err: any) {
    console.error("buyer-push: sendNotification failed:", err?.message || err);
    return { ok: false, error: err?.message || "Push send failed" };
  }
}

/** Browser PushSubscriptionJSON shape (no DOM types in server lib). */
type PushSubscriptionJSON = {
  endpoint: string;
  keys?: { p256dh: string; auth: string };
  expirationTime?: number | null;
};
