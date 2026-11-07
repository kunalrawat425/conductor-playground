import { createContext, useContext, useSyncExternalStore } from "react";
import { Platform, useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
import { API, STAGE_HEADERS } from "../api";
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
// Dev/screenshot switch, honoured only when set in .env.local: EXPO_PUBLIC_FESTIVE_OVERRIDE=off|diwali.
const OVERRIDE = process.env.EXPO_PUBLIC_FESTIVE_OVERRIDE === "off" || process.env.EXPO_PUBLIC_FESTIVE_OVERRIDE === "diwali" ? process.env.EXPO_PUBLIC_FESTIVE_OVERRIDE : null;
let festiveNow = OVERRIDE ? OVERRIDE === "diwali" : festiveFor(new Date()) === "diwali";
const listeners = new Set<() => void>();
const setFestive = (v: boolean) => { if (v !== festiveNow) { festiveNow = v; listeners.forEach((l) => l()); } };
export const isFestive = () => festiveNow;
/** Pins light/dark and Diwali for one subtree (the dev gallery renders all 4 modes side by side). */
export const ThemeMode = createContext<{ dark?: boolean; festive?: boolean } | null>(null);
export function useFestive() {
  const pinned = useContext(ThemeMode);
  const live = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, isFestive, isFestive);
  return pinned?.festive ?? live;
}
const THEME_KEY = "rlf_festive";
export async function loadFestive() {
  if (OVERRIDE) return;
  const read = () => (Platform.OS === "web" ? Promise.resolve(globalThis.localStorage?.getItem(THEME_KEY) ?? null) : SecureStore.getItemAsync(THEME_KEY));
  const save = (v: string) => (Platform.OS === "web" ? globalThis.localStorage?.setItem(THEME_KEY, v) : SecureStore.setItemAsync(THEME_KEY, v));
  const saved = await read().catch(() => null);
  if (saved) setFestive(saved === "diwali");
  try {
    const r = await fetch(`${API}/api/theme`, { headers: STAGE_HEADERS });
    // Prod has no /api/theme yet (404): the date window decides, not a stale saved value.
    if (!r.ok) { setFestive(festiveFor(new Date()) === "diwali"); return; }
    const { festive: f } = await r.json();
    setFestive(f === "diwali");
    await save(f === "diwali" ? "diwali" : "off");
  } catch {} // offline: keep the saved value or the date window
}

export function useIsDark() {
  const pinned = useContext(ThemeMode);
  const scheme = useColorScheme();
  return pinned?.dark ?? scheme === "dark";
}
export function useTheme(): Theme {
  return useIsDark() ? DARK : LIGHT;
}

/**
 * Colours the website writes as literals in page/component CSS (not --v2 tokens), with their dark-mode values
 * where the site has one. Taken from public/design-system/live.html (computed styles, light + dark).
 */
export const lit = {
  headerGrad: (dark: boolean, festive: boolean) => festive ? `linear-gradient(135deg, ${dark ? tokens.festive.headerFromDark : tokens.festive.headerFrom} 0%, ${dark ? tokens.festive.headerToDark : tokens.festive.headerTo} 100%)` : null,
  iconBtnBg: "rgba(255, 255, 255, 0.15)", iconBtnBorder: "rgba(255, 255, 255, 0.18)", backBg: "rgba(255, 255, 255, 0.12)",
  pbGrad: "linear-gradient(135deg, #EEF2FF, #E0E7FF)", pbBorder: "#C7D2FE",
  catRing: (dark: boolean) => dark ? "rgba(0, 102, 255, 0.35)" : "#CCE0FF", catIdleBorder: (dark: boolean) => dark ? "#475569" : "#E2E8F0",
  hue: { sky: "linear-gradient(135deg,#E0F2FE,#BAE6FD)", green: "linear-gradient(135deg,#ECFDF5,#D1FAE5)", orange: "linear-gradient(135deg,#FFF7ED,#FED7AA)", indigo: "linear-gradient(135deg,#EEF2FF,#E0E7FF)" },
  scOverlay: "linear-gradient(180deg, rgba(0,0,0,.08) 0%, rgba(0,0,0,.28) 100%)",
  scDeliveryBorder: (dark: boolean) => dark ? "rgba(5, 150, 105, 0.25)" : "#D1FAE5",
  cartBlue: "#0066FF", cartShadow: "0px 8px 24px 0px rgba(0, 102, 255, 0.35)", preorderInk: "#7C3AED",
  itemImgGrad: "linear-gradient(135deg, #F3E8FF, #E9D5FF)", itemTierBorder: "#C4B5FD",
  bestValue: "#16A34A",
  heroShade: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,.55) 100%)", avatarGrad: "linear-gradient(135deg, #0066FF, #3B82F6)",
  giftGrad: "linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 55%, #FED7AA 100%)", giftBorder: "#FDBA74", giftTitle: "#9A3412", giftText: "#7C2D12",
  odHero: { brand: "linear-gradient(135deg, #0066FF, #3B82F6)", green: "linear-gradient(135deg,#059669,#10B981)", red: "linear-gradient(135deg,#DC2626,#EF4444)", amber: "linear-gradient(135deg,#D97706,#F59E0B)", indigo: "linear-gradient(135deg,#6366F1,#818CF8)", purple: "linear-gradient(135deg,#7C3AED,#A78BFA)" },
  redSoftBorder: "#FCA5A5",
  meHero: "linear-gradient(160deg, #003580 0%, #0055CC 45%, #0077E6 75%, #0EA5E9 100%)", meRing: "rgba(255, 255, 255, 0.07)",
  qa: { pin: ["#EFF6FF", "#2563EB"], orders: ["#F0FDF4", "#16A34A"], bell: ["#FFF7ED", "#EA580C"], phone: ["#F5F3FF", "#7C3AED"] },
  emailInk: "#1D4ED8", emailBtn: "#2563EB", emailBorder: "#BFDBFE",
  dashGrad: "linear-gradient(135deg, #059669, #10B981)",
  cancelPill: ["#FEE2E2", "#DC2626"],
};
/** Inter at the site's weights: React Native needs one font family per weight. */
export const font = (w: 400 | 500 | 600 | 700 | 800 | 900 = 400) => ({ fontFamily: tokens.font[w] });
export const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** The header's sun/moon button (web: localStorage v2_theme). null = follow the phone. */
const PREF_KEY = "v2_theme";
let themePref: "light" | "dark" | null = null;
const prefListeners = new Set<() => void>();
export function useThemePref() {
  return useSyncExternalStore((l) => { prefListeners.add(l); return () => { prefListeners.delete(l); }; }, () => themePref, () => themePref);
}
export async function loadThemePref() {
  const v = await (Platform.OS === "web" ? Promise.resolve(globalThis.localStorage?.getItem(PREF_KEY) ?? null) : SecureStore.getItemAsync(PREF_KEY)).catch(() => null);
  if (v === "light" || v === "dark") { themePref = v; prefListeners.forEach((l) => l()); }
}
export function setThemePref(v: "light" | "dark") {
  themePref = v; prefListeners.forEach((l) => l());
  (Platform.OS === "web" ? Promise.resolve(globalThis.localStorage?.setItem(PREF_KEY, v)) : SecureStore.setItemAsync(PREF_KEY, v)).catch(() => {});
}
