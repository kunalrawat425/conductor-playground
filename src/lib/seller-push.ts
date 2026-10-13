import { updateSellerProfile } from "./supabase";
import { getOrCreateSubscription } from "./push-subscription";

/**
 * Subscribe the current seller to Web Push notifications.
 * Uses /api/seller/profile (service role key) to bypass RLS.
 */
export async function subscribeSellerPush(sellerId: string, askPermission = true): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }

  try {
    const subscription = await getOrCreateSubscription(import.meta.env.PUBLIC_VAPID_KEY || "", askPermission);
    if (!subscription) return false;

    await updateSellerProfile(sellerId, {
      push_subscription: subscription.toJSON(),
      push_enabled: true,
    } as any);

    return true;
  } catch (err) {
    console.error("Seller push subscription failed:", err);
    return false;
  }
}

/**
 * Unsubscribe seller from push notifications.
 */
export async function unsubscribeSellerPush(sellerId: string): Promise<void> {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  const registration = await navigator.serviceWorker?.ready;
  // The browser subscription is shared with a buyer login on this device: only clear ours.
  void registration;

  await updateSellerProfile(sellerId, {
    push_subscription: null,
    push_enabled: false,
  } as any);
}

/**
 * Check if push is currently subscribed.
 */
export async function isSellerPushSubscribed(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  await navigator.serviceWorker.register("/sw.js").catch(() => {});
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return !!subscription;
}
