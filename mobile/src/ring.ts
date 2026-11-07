import notifee, { AndroidCategory, AndroidImportance, AndroidStyle, AndroidVisibility, EventType } from "@notifee/react-native";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

/**
 * New order with the app closed or the phone locked: rings like a call (Rapido / Uber style).
 * The server sends a data-only FCM message { kind: "new_order", order_id, title, body, url, image? }; this task
 * (run headless by expo-task-manager) shows it full-screen over the lock screen, the ringtone looping until the
 * seller taps it, the app opens, or 60 s pass. Other pushes are normal FCM notifications (with image) and skip this.
 */
export const RING_TASK = "relifish-new-order-ring";
const RING_CAP_MS = 60_000;

type RingData = { kind?: string; order_id?: string; title?: string; body?: string; url?: string; image?: string; tag?: string };

function payloadData(p: any): RingData {
  // Expo hands the FCM data to the task at different depths (data, data.data, a JSON string); find dataString wherever it is.
  for (const x of [p, p?.data, p?.data?.data, p?.notification?.data, p?.data?.notification?.data]) {
    if (!x) continue;
    const o = typeof x === "string" ? (() => { try { return JSON.parse(x); } catch { return null; } })() : x;
    if (o && typeof o.dataString === "string") { try { return JSON.parse(o.dataString); } catch {} }
  }
  return p?.data ?? {};
}

export async function showRing(d: RingData) {
  if (Platform.OS !== "android") return;
  const channelId = await notifee.createChannel({
    id: "ring", name: "New order (rings)", sound: "new_order", importance: AndroidImportance.HIGH,
    vibration: true, vibrationPattern: [300, 800, 400, 800], visibility: AndroidVisibility.PUBLIC, bypassDnd: true,
  });
  await notifee.displayNotification({
    id: `ring-${d.order_id || "new"}`,
    title: d.title || "New Relifish order",
    body: d.body || "Tap to see and confirm it",
    data: { url: d.url || "/dashboard/orders" },
    android: {
      channelId,
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      loopSound: true,
      ongoing: true,
      autoCancel: true,
      lightUpScreen: true,
      timeoutAfter: RING_CAP_MS,
      pressAction: { id: "default", launchActivity: "default" },
      fullScreenAction: { id: "default", launchActivity: "default" },
      actions: [{ title: "View order", pressAction: { id: "default", launchActivity: "default" } }],
      ...(d.image ? { style: { type: AndroidStyle.BIGPICTURE, picture: d.image } } : {}),
    },
  });
}

/** An order update (buyer) or other alert: the photo as a big picture and Track order / Call us buttons (preview "Rich notification"). */
export async function showRich(d: RingData) {
  if (Platform.OS !== "android") return;
  const channelId = await notifee.createChannel({ id: "updates", name: "Order updates", importance: AndroidImportance.HIGH, sound: "default", visibility: AndroidVisibility.PUBLIC });
  const order = d.order_id || /\/track\/([\w-]+)/.exec(d.url || "")?.[1];
  await notifee.displayNotification({
    ...(d.tag ? { id: d.tag } : {}),
    title: d.title || "Relifish",
    body: d.body || "",
    data: { url: d.url || "" },
    android: {
      channelId, color: "#0066FF", pressAction: { id: "default", launchActivity: "default" },
      ...(d.image ? { largeIcon: d.image, style: { type: AndroidStyle.BIGPICTURE, picture: d.image } } : d.body ? { style: { type: AndroidStyle.BIGTEXT, text: d.body } } : {}),
      actions: [
        ...(order ? [{ title: "Track order", pressAction: { id: "track", launchActivity: "default" } }] : []),
        { title: "Call us", pressAction: { id: "call", launchActivity: "default" } },
      ],
    },
  });
}

/** The app is open (or the seller tapped): stop every ringing notification. */
export const stopRings = () => (Platform.OS === "android" ? notifee.cancelAllNotifications().catch(() => {}) : Promise.resolve());

TaskManager.defineTask(RING_TASK, async ({ data }) => {
  console.log("RLF_TASK_DATA", JSON.stringify(data).slice(0, 600));
  const d = payloadData(data);
  if (d.kind === "new_order") await showRing(d);
  else if (d.kind === "update") await showRich(d);
});
Notifications.registerTaskAsync(RING_TASK).catch(() => {});
// Taps and dismissals while the app is closed; opening the app stops the ring (src/NewOrderAlarm.tsx).
notifee.onBackgroundEvent(async ({ type }) => {
  if (type === EventType.PRESS || type === EventType.ACTION_PRESS || type === EventType.DISMISSED) await stopRings();
});
