import { getSession } from "./auth";

/**
 * Subscribe the current buyer to Web Push notifications.
 * Uses /api/buyer/push-subscribe (service role key) to bypass RLS.
 */
export async function subscribePush(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }

  try {
    const session = getSession();
    if (!session) return false;

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const vapidKey = (import.meta as any).env?.PUBLIC_VAPID_KEY;
      if (!vapidKey) {
        console.warn("VAPID public key not configured");
        return false;
      }

      const keyBytes = urlBase64ToUint8Array(vapidKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer.slice(
          keyBytes.byteOffset,
          keyBytes.byteOffset + keyBytes.byteLength
        ) as ArrayBuffer,
      });
    }

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
  const registration = await navigator.serviceWorker?.ready;
  const subscription = await registration?.pushManager?.getSubscription();
  if (subscription) {
    await subscription.unsubscribe();
  }

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
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return !!subscription;
}

// Convert VAPID key from base64 URL to Uint8Array
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
