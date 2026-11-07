import { Platform } from "react-native";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { API, getSession } from "./api";

/** The site's funnel log (/api/track → funnel_events): same event names, source "app-<os>-<version>". Never blocks. */
let visitor: string | null = null;
export async function track(event: string, extra: { seller_id?: string; path?: string; meta?: Record<string, unknown> } = {}) {
  try {
    if (!visitor) {
      visitor = (await SecureStore.getItemAsync("rlf_visitor").catch(() => null)) || `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      SecureStore.setItemAsync("rlf_visitor", visitor).catch(() => {});
    }
    const me = await getSession();
    fetch(`${API}/api/track`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ event, visitor_id: visitor, buyer_id: me?.buyer_id, source: `app-${Platform.OS}-${Constants.expoConfig?.version}`, ...extra }) }).catch(() => {});
  } catch {}
}
