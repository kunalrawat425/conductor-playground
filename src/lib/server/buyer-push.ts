import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { buyerOrderPushNotification } from "./buyer-order-push-copy";
import { loadWebPush } from "./load-web-push";
import { normalizeVapidKeyForWebPush, trimVapidKey } from "./vapid-env";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const vapidPublicKey = normalizeVapidKeyForWebPush(import.meta.env.PUBLIC_VAPID_KEY || "");
const vapidPrivateKey = normalizeVapidKeyForWebPush(import.meta.env.VAPID_PRIVATE_KEY || "");
/** mailto: or https: URL required by web-push (see VAPID_CONTACT in .env.example) */
const vapidContact = trimVapidKey(import.meta.env.VAPID_CONTACT || "") || "mailto:hello@reslifih.app";

export type BuyerPushPayload = {
  buyer_id: string;
  status: string;
  /** When set, included in the tag for debugging; each push still gets a unique tag so OS does not replace prior toasts. */
  order_id?: string | null;
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
  const { buyer_id, status, order_id, species, final_price } = payload;

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

  const notification = buyerOrderPushNotification(status, species, final_price);
  /** Unique tag every time — same tag replaces the previous notification in the OS tray. */
  const pushTag = order_id
    ? `reslifih-order-${order_id}-${randomUUID()}`
    : `reslifih-buyer-${buyer_id}-${status}-${randomUUID()}`;

  try {
    const webPush = await loadWebPush();
    webPush.setVapidDetails(vapidContact, vapidPublicKey, vapidPrivateKey);
    await webPush.sendNotification(
      subscription,
      JSON.stringify({
        ...notification,
        url: "/track",
        tag: pushTag,
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
