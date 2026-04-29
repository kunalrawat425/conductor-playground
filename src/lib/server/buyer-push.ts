import { createClient } from "@supabase/supabase-js";
import { buyerOrderPushNotification } from "./buyer-order-push-copy";
import { loadWebPush } from "./load-web-push";
import { absoluteUrl } from "./site-origin";
import { normalizeVapidKeyForWebPush, trimVapidKey } from "./vapid-env";
import { resolveBuyerIdForPush } from "./resolve-buyer-push-id";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const vapidPublicKey = normalizeVapidKeyForWebPush(import.meta.env.PUBLIC_VAPID_KEY || "");
const vapidPrivateKey = normalizeVapidKeyForWebPush(import.meta.env.VAPID_PRIVATE_KEY || "");
/** mailto: or https: URL required by web-push (see VAPID_CONTACT in .env.example) */
const vapidContact = trimVapidKey(import.meta.env.VAPID_CONTACT || "") || "mailto:hello@relifish.app";

export type BuyerPushPayload = {
  /** Prefer UUID from orders.buyer_id */
  buyer_id?: string | null;
  /** When buyer_id is null, lookup buyers row by phone (guest / legacy orders). */
  buyer_phone?: string | null;
  status: string;
  species?: string | null;
  final_price?: number | null;
  /** When set, notification opens this order on `/v2/track/[id]` (else track list). */
  order_id?: string | null;
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
  const { buyer_id, buyer_phone, status, species, final_price, order_id } = payload;

  if (!status) {
    return { ok: false, error: "Missing status" };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const effectiveBuyerId = await resolveBuyerIdForPush(supabase, buyer_id, buyer_phone);
  if (!effectiveBuyerId) {
    return {
      ok: true,
      sent: false,
      reason:
        "no buyer account for push — same phone must have signed in once (/v2/me) and enabled notifications",
    };
  }

  const { data: buyer } = await supabase
    .from("buyers")
    .select("push_subscription, push_enabled")
    .eq("id", effectiveBuyerId)
    .single();

  const subscription = normalizeSubscription(buyer?.push_subscription);
  if (!subscription?.endpoint) {
    return {
      ok: true,
      sent: false,
      reason:
        "no push subscription — open /v2/me, tap the bell, allow notifications, then try again",
    };
  }

  // Send if we have keys on file; heal push_enabled when a subscription exists but the flag was false
  if (!buyer?.push_enabled) {
    await supabase.from("buyers").update({ push_enabled: true }).eq("id", effectiveBuyerId);
  }

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error("buyer-push: VAPID keys not configured");
    return { ok: false, error: "VAPID keys not configured" };
  }

  const notification = buyerOrderPushNotification(status, species, final_price);
  const trackPath = order_id ? `/v2/track/${order_id}` : "/v2/track";
  const openUrl = absoluteUrl(trackPath);

  try {
    const webPush = await loadWebPush();
    webPush.setVapidDetails(vapidContact, vapidPublicKey, vapidPrivateKey);
    const uniqueTag = `order-${effectiveBuyerId}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    await webPush.sendNotification(
      subscription,
      JSON.stringify({
        ...notification,
        url: openUrl,
        tag: uniqueTag,
      })
    );
    return { ok: true, sent: true };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("buyer-push: failed:", msg);
    return { ok: false, error: msg || "Push send failed" };
  }
}

/** Browser PushSubscriptionJSON shape (no DOM types in server lib). */
type PushSubscriptionJSON = {
  endpoint: string;
  keys?: { p256dh: string; auth: string };
  expirationTime?: number | null;
};
