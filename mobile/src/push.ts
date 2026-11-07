import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";
import notifee, { EventType } from "@notifee/react-native";
import { showRich } from "./ring";
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
 * Partner app: ask for notifications as soon as it opens (new orders must ring). Buyer app: only when the buyer taps
 * "Allow" on the Home banner, like the website (shop.astro); at launch it just re-saves the token if already allowed. Then, once logged in,
 * save this phone's FCM token as the buyer's / seller's push subscription `{ endpoint: "fcm", fcm }` so the
 * website's senders reach the app (Firebase project "relifish"; google-services.json per app in mobile/firebase/).
 * Quietly does nothing in Expo Go.
 */
export async function registerPush() {
  try {
    if (Constants.executionEnvironment === "storeClient") return;
    await ensureChannels();
    const { status } = ROLE === "seller" ? await Notifications.requestPermissionsAsync() : await Notifications.getPermissionsAsync();
    if (status !== "granted") return;
    const me = await getSession();
    if (!me) return;
    const { data: token } = await Notifications.getDevicePushTokenAsync();
    // QA builds point at stage: print the token so push can be tested on an emulator (never in a prod build).
    if (/stage/.test(String(process.env.EXPO_PUBLIC_API_BASE))) console.log("RLF_FCM_TOKEN", String(token));
    const subscription = { endpoint: "fcm", fcm: String(token), platform: Platform.OS };
    if (ROLE === "seller") await api("/api/seller/profile", { seller_id: me.seller_id, seller_phone: me.phone, updates: { push_subscription: subscription, push_enabled: true } });
    else await api("/api/buyer/push-subscribe", { buyer_id: me.buyer_id, subscription });
  } catch (e) {
    console.warn("push registration skipped:", (e as Error).message);
  }
}

/** Open what a notification is about: the server sends the website URL (…/track/<id>, /dashboard/orders). */
function openUrl(url: string, action?: string) {
  if (action === "call") { Linking.openURL("tel:+919152207607"); return; }
  const order = /\/track\/([\w-]+)/.exec(url)?.[1];
  if (order) router.push(`/order/${order}`);
  else if (url.includes("/dashboard")) router.push("/partner/orders");
}
/**
 * Taps: Expo-shown notifications (iOS alerts), and the app-drawn Android ones (Notifee: body tap, Track order, Call us),
 * including the one that cold-started the app. An update that lands while the app is open is drawn the same way.
 */
export function onPushTap() {
  const a = Notifications.addNotificationResponseReceivedListener((r) => openUrl(String((r.notification.request.content.data as any)?.url || "")));
  const b = Notifications.addNotificationReceivedListener((n) => {
    const raw: any = n.request.content.data || {};
    console.log("RLF_RECV", JSON.stringify(n.request.content).slice(0, 600), JSON.stringify((n.request as any).trigger || {}).slice(0, 600));
    try { const d = typeof raw.dataString === "string" ? JSON.parse(raw.dataString) : raw; if (d?.kind === "update") showRich(d); } catch {}
  });
  const c = notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS || type === EventType.ACTION_PRESS) openUrl(String(detail.notification?.data?.url || ""), detail.pressAction?.id);
  });
  notifee.getInitialNotification().then((i) => i && openUrl(String(i.notification.data?.url || ""), i.pressAction?.id)).catch(() => {});
  return { remove: () => { a.remove(); b.remove(); c(); } };
}
