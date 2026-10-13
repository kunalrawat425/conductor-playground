import { getSession } from "./auth";
import { getOrCreateSubscription } from "./push-subscription";

/**
 * Subscribe the current buyer to Web Push notifications.
 * Uses /api/buyer/push-subscribe (service role key) to bypass RLS.
 */
export async function subscribePush(askPermission = true): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }

  try {
    const session = getSession();
    if (!session) return false;

    const subscription = await getOrCreateSubscription(import.meta.env.PUBLIC_VAPID_KEY || "", askPermission);
    if (!subscription) return false;

    const res = await fetch("/api/buyer/push-subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buyer_id: session.buyer_id,
        subscription: subscription.toJSON(),
      }),
    });
    if (!res.ok) throw new Error("Failed to save subscription");

    return true;
  } catch (err) {
    console.error("Push subscription failed:", err);
    return false;
  }
}

/**
 * Unsubscribe from push notifications.
 */
export async function unsubscribePush(): Promise<void> {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  const registration = await navigator.serviceWorker?.ready;
  // The browser subscription is shared with a seller login on this device: only clear ours.
  void registration;

  const session = getSession();
  if (!session) return;

  await fetch("/api/buyer/push-subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      buyer_id: session.buyer_id,
      subscription: null,
    }),
  });
}

/**
 * Check if push is currently subscribed.
 */
export async function isPushSubscribed(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  await navigator.serviceWorker.register("/sw.js").catch(() => {});
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return !!subscription;
}
