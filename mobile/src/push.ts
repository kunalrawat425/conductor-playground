import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { router } from "expo-router";
import { api, getSession, ROLE } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/**
 * Android channels, created at launch: "orders" rings like a call for a seller's new order (MAX importance, the
 * bundled new_order.wav, long vibration, shows on the lock screen, through Do Not Disturb where the phone allows);
 * "default" for everything else. The server picks the channel (src/lib/server/load-web-push.ts).
 * iOS: the push carries the same sound; critical alerts (ringing through silent mode) need an Apple entitlement we don't have.
 */
export async function ensureChannels() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("orders", {
    name: "New orders",
    importance: Notifications.AndroidImportance.MAX,
    sound: "new_order.wav",
    vibrationPattern: [0, 800, 400, 800, 400, 800],
    enableVibrate: true,
    bypassDnd: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    audioAttributes: { usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE, contentType: Notifications.AndroidAudioContentType.SONIFICATION },
  });
  await Notifications.setNotificationChannelAsync("default", { name: "Updates", importance: Notifications.AndroidImportance.HIGH });
}

/**
 * Ask for notifications as soon as the app opens (the native "Allow notifications?" prompt), then, once logged in,
 * save this phone's FCM token as the buyer's / seller's push subscription `{ endpoint: "fcm", fcm }` so the
 * website's senders reach the app (Firebase project "relifish"; google-services.json per app in mobile/firebase/).
 * Quietly does nothing in Expo Go.
 */
export async function registerPush() {
  try {
    if (Constants.executionEnvironment === "storeClient") return;
    await ensureChannels();
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const me = await getSession();
    if (!me) return;
    const { data: token } = await Notifications.getDevicePushTokenAsync();
    const subscription = { endpoint: "fcm", fcm: String(token), platform: Platform.OS };
    if (ROLE === "seller") await api("/api/seller/profile", { seller_id: me.seller_id, seller_phone: me.phone, updates: { push_subscription: subscription, push_enabled: true } });
    else await api("/api/buyer/push-subscribe", { buyer_id: me.buyer_id, subscription });
  } catch (e) {
    console.warn("push registration skipped:", (e as Error).message);
  }
}

/** Tapping a notification opens what it's about: the server sends the website URL (…/track/<id>, /dashboard/orders). */
export function onPushTap() {
  return Notifications.addNotificationResponseReceivedListener((r) => {
    const url = String((r.notification.request.content.data as any)?.url || "");
    const order = /\/track\/([\w-]+)/.exec(url)?.[1];
    if (order) router.push(`/order/${order}`);
    else if (url.includes("/dashboard")) router.push("/partner/orders");
  });
}
