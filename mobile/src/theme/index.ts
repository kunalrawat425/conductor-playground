import { useSyncExternalStore } from "react";
import { Platform, useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
import { API } from "../api";
import { tokens } from "./tokens";
import { festiveFor } from "../../../src/lib/festive-window";

/** The website's colours (generated from src/styles/tokens.css), with the names the screens use. */
function palette(c: typeof tokens.light | typeof tokens.dark) {
  return {
    ...c,
    page: c.bg2,          // body background on the site
    card: c.bg,           // cards, sheets, tab bar
    brandSoft: c.brandL,
    greenSoft: c.greenL,
    redSoft: c.redL,
    amberSoft: c.amberL,
    purpleSoft: c.purpleL,
    onBrand: tokens.light.bg, // text on brand-blue buttons (white in both modes, as on the site)
  };
}
const LIGHT = palette(tokens.light);
const DARK = palette(tokens.dark);
export type Theme = typeof LIGHT;
export const radius = tokens.radius;
export const space = tokens.space;
export const shadow = tokens.shadow;
export const festive = tokens.festive;
/**
 * Diwali header etc. while the site runs its festive theme. The site decides (GET /api/theme, which follows
 * PUBLIC_FESTIVE_THEME and the date window), so it switches without a store release. Until that answers:
 * the last answer we saved, else the same date window offline.
 */
let festiveNow = festiveFor(new Date()) === "diwali";
const listeners = new Set<() => void>();
const setFestive = (v: boolean) => { if (v !== festiveNow) { festiveNow = v; listeners.forEach((l) => l()); } };
export const isFestive = () => festiveNow;
export function useFestive() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, isFestive, isFestive);
}
const THEME_KEY = "rlf_festive";
export async function loadFestive() {
  const read = () => (Platform.OS === "web" ? Promise.resolve(globalThis.localStorage?.getItem(THEME_KEY) ?? null) : SecureStore.getItemAsync(THEME_KEY));
  const save = (v: string) => (Platform.OS === "web" ? globalThis.localStorage?.setItem(THEME_KEY, v) : SecureStore.setItemAsync(THEME_KEY, v));
  const saved = await read().catch(() => null);
  if (saved) setFestive(saved === "diwali");
  try {
    const r = await fetch(`${API}/api/theme`);
    if (!r.ok) return;
    const { festive: f } = await r.json();
    setFestive(f === "diwali");
    await save(f === "diwali" ? "diwali" : "off");
  } catch {} // offline: keep the saved value or the date window
}

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? DARK : LIGHT;
}
/** Inter at the site's weights: React Native needs one font family per weight. */
export const font = (w: 400 | 500 | 600 | 700 | 800 | 900 = 400) => ({ fontFamily: tokens.font[w] });
export const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
