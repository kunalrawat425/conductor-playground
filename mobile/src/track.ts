import { Platform } from "react-native";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { API, getSession } from "./api";

/** Firebase Analytics (GA4) with the web's gtag event names. No-op where the native module is missing (Expo Go, web). */
export function ga(name: string, params: Record<string, string | number | undefined> = {}) {
  if (Platform.OS === "web") return;
  try {
    const a = require("@react-native-firebase/analytics");
    a.logEvent(a.getAnalytics(), name, Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))).catch(() => {});
  } catch {}
}

/** The site's funnel log (and the same event to Firebase Analytics) (/api/track → funnel_events): same event names, source "app-<os>-<version>". Never blocks. */
let visitor: string | null = null;
export async function track(event: string, extra: { seller_id?: string; path?: string; meta?: Record<string, unknown> } = {}) {
  ga(event, { seller_id: extra.seller_id });
  try {
    if (!visitor) {
      visitor = (await SecureStore.getItemAsync("rlf_visitor").catch(() => null)) || `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      SecureStore.setItemAsync("rlf_visitor", visitor).catch(() => {});
    }
    const me = await getSession();
    fetch(`${API}/api/track`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ event, visitor_id: visitor, buyer_id: me?.buyer_id, source: `app-${Platform.OS}-${Constants.expoConfig?.version}`, ...extra }) }).catch(() => {});
  } catch {}
}
