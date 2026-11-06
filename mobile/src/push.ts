import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { router } from "expo-router";
import { api, getSession, ROLE } from "./api";

/** Must match EXPO_PUSH_URL in src/lib/server/load-web-push.ts: the server sends `{ expo }` subscriptions to Expo. */
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/**
 * Ask for notifications and save this phone's Expo push token as the buyer's / seller's push subscription,
 * so the website's existing senders (order updates, new-order alerts) reach the app. Quietly does nothing in
 * Expo Go, on an emulator without Play services, or before an EAS project id exists (founder step).
 */
export async function registerPush() {
  try {
    const me = await getSession();
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    if (!me || !Device.isDevice || Constants.executionEnvironment === "storeClient" || !projectId) return;
    if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("orders", { name: "Orders", importance: Notifications.AndroidImportance.HIGH });
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const subscription = { endpoint: EXPO_PUSH_URL, expo: token };
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
