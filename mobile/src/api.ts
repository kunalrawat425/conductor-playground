import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";

// expoConfig.extra is empty in the web preview, so EXPO_PUBLIC_* (inlined at bundle time) wins, then app.config.ts, then production.
const extra = (Constants.expoConfig?.extra as any) || {};
export const API = process.env.EXPO_PUBLIC_API_BASE || extra.apiBase || "https://www.relifish.com";

// Public read-only data (sellers, fish) the same way the website reads it; everything else goes through /api.
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || "https://witoghpdfocywiosmrzv.supabase.co",
  process.env.EXPO_PUBLIC_SUPABASE_ANON || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndpdG9naHBkZm9jeXdpb3Ntcnp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNDU3NzMsImV4cCI6MjA5MDkyMTc3M30.Hcopt8LHt9xh24Ckg9A9JaBy-BtVisAcj8NICaP8aIQ",
  { auth: { persistSession: false } },
);

/** "buyer" = Relifish, "partner" = Relifish Partner (sellers); one codebase, APP_VARIANT picks it (app.config.ts). */
export const VARIANT: "buyer" | "partner" = (process.env.EXPO_PUBLIC_APP_VARIANT || extra.variant) === "partner" ? "partner" : "buyer";
export const ROLE: "buyer" | "seller" = VARIANT === "partner" ? "seller" : "buyer";

export type Session = { buyer_id?: string; seller_id?: string; name?: string; phone: string; token: string };
const KEY = `rlf_${ROLE}_session`;
let cached: Session | null | undefined;

export async function getSession(): Promise<Session | null> {
  if (cached !== undefined) return cached;
  // Browser preview (react-native-web) has no secure store: use localStorage there.
  const raw = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) ?? null : await SecureStore.getItemAsync(KEY);
  cached = raw ? JSON.parse(raw) : null;
  return cached ?? null;
}
export async function setSession(s: Session | null) {
  cached = s;
  if (Platform.OS === "web") { if (s) globalThis.localStorage?.setItem(KEY, JSON.stringify(s)); else globalThis.localStorage?.removeItem(KEY); return; }
  if (s) await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  else await SecureStore.deleteItemAsync(KEY);
}

/** The website's API, with the signed session the server checks (x-rlf-buyer / x-rlf-seller, like the site). */
export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const s = await getSession();
  const res = await fetch(API + path, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(s ? { [`x-rlf-${ROLE}`]: s.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && (data as any)?.login) await setSession(null);
  if (!res.ok) {
    const err: any = new Error((data as any)?.error || `Something went wrong (${res.status})`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data as T;
}
