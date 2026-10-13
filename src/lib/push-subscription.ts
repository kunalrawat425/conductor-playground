/**
 * One push subscription per browser, shared by the buyer and seller logins on
 * that device. Reuse it instead of unsubscribing first: the old code cancelled
 * and recreated it on every refresh, which killed the other role's stored
 * endpoint (410 Gone) and lost the subscription if the save then failed.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** True when the subscription was made with this VAPID key (else it must be recreated). */
export function sameServerKey(existing: ArrayBuffer | null | undefined, wanted: Uint8Array): boolean {
  if (!existing) return false;
  const a = new Uint8Array(existing);
  if (a.length !== wanted.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== wanted[i]) return false;
  return true;
}

/** Existing subscription if it matches the VAPID key, else a new one. Null if not allowed. */
export async function getOrCreateSubscription(vapidKey: string, askPermission: boolean): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !vapidKey) return null;
  await navigator.serviceWorker.register("/sw.js").catch(() => {});
  const registration = await navigator.serviceWorker.ready;
  const keyBytes = urlBase64ToUint8Array(vapidKey);
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameServerKey(existing.options?.applicationServerKey, keyBytes)) return existing;
  if (existing) await existing.unsubscribe().catch(() => {}); // made with an old VAPID key: unusable
  if (typeof Notification !== "undefined") {
    if (Notification.permission === "denied") return null;
    if (Notification.permission === "default") {
      if (!askPermission) return null;
      if ((await Notification.requestPermission()) !== "granted") return null;
    }
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
  });
}
