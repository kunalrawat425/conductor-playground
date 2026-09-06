import { createClient } from "@supabase/supabase-js";
import { buyerOrderPushNotification } from "./buyer-order-push-copy";
import { loadWebPush } from "./load-web-push";
import { absoluteUrl } from "./site-origin";
import { normalizeVapidKeyForWebPush, trimVapidKey } from "./vapid-env";
import { resolveBuyerIdForPush } from "./resolve-buyer-push-id";

function getPushConfig() {
  const supabaseUrl = import.meta.env?.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || "";
  const supabaseServiceKey = import.meta.env?.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  const vapidPublicKey = normalizeVapidKeyForWebPush(import.meta.env?.PUBLIC_VAPID_KEY || process.env.PUBLIC_VAPID_KEY || "");
  const vapidPrivateKey = normalizeVapidKeyForWebPush(import.meta.env?.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY || "");
  const vapidContact = trimVapidKey(import.meta.env?.VAPID_CONTACT || process.env.VAPID_CONTACT || "") || "mailto:relifishstore@gmail.com";

  return { supabaseUrl, supabaseServiceKey, vapidPublicKey, vapidPrivateKey, vapidContact };
}

async function logPushToDb(
  supabase: any,
  buyerId: string,
  title: string,
  body: string,
  url: string,
  status: "success" | "failed",
  errorMessage?: string | null
) {
  try {
    await supabase.from("push_notification_logs").insert({
      buyer_id: buyerId,
      title,
      body,
      url,
      status,
      error_message: errorMessage || null,
    });
  } catch (e) {
    console.warn("Could not write to push_notification_logs table (migration may not be applied yet):", e);
  }
}




/**
 * BUG-22 fix: when a push endpoint is gone (404) or expired (410), the stored
 * subscription is permanently dead. Previously we only logged the failure, so
 * the dead endpoint stayed on the row and EVERY future push to that buyer
 * failed forever with no self-healing.
 *
 * Web Push spec: 404 = endpoint not found, 410 = subscription expired/revoked.
 * Both are terminal — clear the subscription so the buyer is re-prompted to
 * subscribe next time they open /me.
 */
async function pruneDeadSubscription(supabase: any, buyerId: string, err: any): Promise<boolean> {
  const { isTerminalPushError, pushErrorStatus } = await import("./push-error-classify");
  if (!isTerminalPushError(err)) return false;
  const code = pushErrorStatus(err);
  try {
    await supabase
      .from("buyers")
      .update({ push_subscription: null, push_enabled: false })
      .eq("id", buyerId);
    console.warn(`[buyer-push] pruned dead subscription for buyer ${buyerId} (HTTP ${code})`);
    return true;
  } catch (e: any) {
    console.warn(`[buyer-push] could not prune dead subscription for ${buyerId}:`, e?.message);
    return false;
  }
}

export type BuyerPushPayload = {
  /** Prefer UUID from orders.buyer_id */
  buyer_id?: string | null;
  /** When buyer_id is null, lookup buyers row by phone (guest / legacy orders). */
  buyer_phone?: string | null;
  status: string;
  species?: string | null;
  final_price?: number | null;
  /** When set, notification opens this order on `/track/[id]` (else track list). */
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

  const { supabaseUrl, supabaseServiceKey, vapidPublicKey, vapidPrivateKey, vapidContact } = getPushConfig();
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const effectiveBuyerId = await resolveBuyerIdForPush(supabase, buyer_id, buyer_phone);
  if (!effectiveBuyerId) {
    return {
      ok: true,
      sent: false,
      reason:
        "no buyer account for push — same phone must have signed in once (/me) and enabled notifications",
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
        "no push subscription — open /me, tap the bell, allow notifications, then try again",
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
  const trackPath = order_id ? `/track/${order_id}` : "/track";
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
    
    // Log success in background (non-blocking)
    logPushToDb(supabase, effectiveBuyerId, notification.title, notification.body, openUrl, "success");
    
    return { ok: true, sent: true };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("buyer-push: failed:", msg);

    // BUG-22: self-heal on terminal endpoint errors
    const pruned = await pruneDeadSubscription(supabase, effectiveBuyerId, err);

    // Log failure in background (non-blocking)
    logPushToDb(supabase, effectiveBuyerId, notification.title, notification.body, openUrl, "failed", msg);

    if (pruned) {
      return { ok: true, sent: false, reason: "subscription expired — cleared, buyer must re-enable notifications" };
    }
    return { ok: false, error: msg || "Push send failed" };
  }
}

/**
 * Send a custom Web Push to a buyer (marketing/promotional/re-engagement).
 * Updates `last_promo_push_sent_at` upon successful send.
 */
export async function sendCustomBuyerPush(
  buyerId: string,
  notification: { title: string; body: string },
  urlPath: string
): Promise<BuyerPushResult> {
  const { supabaseUrl, supabaseServiceKey, vapidPublicKey, vapidPrivateKey, vapidContact } = getPushConfig();
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: buyer } = await supabase
    .from("buyers")
    .select("push_subscription, push_enabled")
    .eq("id", buyerId)
    .single();

  const subscription = normalizeSubscription(buyer?.push_subscription);
  if (!subscription?.endpoint) {
    return {
      ok: true,
      sent: false,
      reason: "no push subscription for buyer",
    };
  }

  if (!buyer?.push_enabled) {
    await supabase.from("buyers").update({ push_enabled: true }).eq("id", buyerId);
  }

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error("buyer-push: VAPID keys not configured");
    return { ok: false, error: "VAPID keys not configured" };
  }

  const openUrl = absoluteUrl(urlPath);

  try {
    const webPush = await loadWebPush();
    webPush.setVapidDetails(vapidContact, vapidPublicKey, vapidPrivateKey);
    const uniqueTag = `custom-${buyerId}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    await webPush.sendNotification(
      subscription,
      JSON.stringify({
        ...notification,
        url: openUrl,
        tag: uniqueTag,
      })
    );

    // Update last_promo_push_sent_at upon successful delivery (gracefully catch if migration not applied yet)
    try {
      await supabase
        .from("buyers")
        .update({ last_promo_push_sent_at: new Date().toISOString() })
        .eq("id", buyerId);
    } catch (e) {
      console.warn("Could not update last_promo_push_sent_at (migration may not be applied yet):", e);
    }

    // Log success in background (non-blocking)
    logPushToDb(supabase, buyerId, notification.title, notification.body, openUrl, "success");

    return { ok: true, sent: true };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("buyer-push: custom failed:", msg);

    // BUG-22: self-heal on terminal endpoint errors
    const pruned = await pruneDeadSubscription(supabase, buyerId, err);

    // Log failure in background (non-blocking)
    logPushToDb(supabase, buyerId, notification.title, notification.body, openUrl, "failed", msg);

    if (pruned) {
      return { ok: true, sent: false, reason: "subscription expired — cleared" };
    }
    return { ok: false, error: msg || "Push send failed" };
  }
}


/** Browser PushSubscriptionJSON shape (no DOM types in server lib). */
type PushSubscriptionJSON = {
  endpoint: string;
  keys?: { p256dh: string; auth: string };
  expirationTime?: number | null;
};
