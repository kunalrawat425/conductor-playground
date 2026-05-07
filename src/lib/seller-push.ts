import { updateSellerProfile } from "./supabase";

/**
 * Subscribe the current seller to Web Push notifications.
 * Uses /api/seller/profile (service role key) to bypass RLS.
 */
export async function subscribeSellerPush(sellerId: string): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }

  try {
    await navigator.serviceWorker.register("/sw.js").catch(() => {});

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      if (typeof Notification !== "undefined") {
        if (Notification.permission === "denied") return false;
        if (Notification.permission === "default") {
          const p = await Notification.requestPermission();
          if (p !== "granted") return false;
        }
      }
      const vapidKey = (import.meta as any).env?.PUBLIC_VAPID_KEY;
      if (!vapidKey) return false;

      const keyBytes = urlBase64ToUint8Array(vapidKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer.slice(
          keyBytes.byteOffset,
          keyBytes.byteOffset + keyBytes.byteLength
        ) as ArrayBuffer,
      });
    }

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
  const subscription = await registration?.pushManager?.getSubscription();
  if (subscription) {
    await subscription.unsubscribe();
  }

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

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
