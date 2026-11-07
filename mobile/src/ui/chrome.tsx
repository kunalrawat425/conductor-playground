/**
 * Page chrome, from the site: AppHeader (organisms/AppHeader.astro), DiwaliLights / DiwaliBanner (DiwaliDecor.astro +
 * festive.css), BottomNav (organisms/BottomNav.astro), DashboardHero / DashboardTabs (pages/dashboard/orders).
 * Sizes are the computed values in public/design-system/live.html.
 */
import { useEffect, useRef } from "react";
import { Animated, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { festive as F, lit, setThemePref, useFestive, useIsDark, useTheme } from "../theme";
import { grad, lh, row, shadowCss, Text } from "./base";
import { Icon, type IconName } from "./icons";

/** .fd-lights: a 1 px gold wire with 24 bulbs (6×8) in three warm colours, twinkling 1.6 s; `still` for screenshots. */
export function DiwaliLights({ height = 14, still }: { height?: number; still?: boolean }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(Animated.timing(a, { toValue: 1, duration: 1600, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [a, still]);
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height, flexDirection: "row", justifyContent: "space-around", zIndex: 1 }}>
      <View style={{ position: "absolute", left: 0, right: 0, top: 2, height: 1, backgroundColor: F.wire }} />
      {Array.from({ length: 24 }, (_, i) => {
        // CSS counts from 1: nth-child(3n+2) amber, nth-child(3n) cream, else gold; even bulbs hang 2 px lower.
        const n = i + 1;
        const color = n % 3 === 2 ? F.bulbs[1] : n % 3 === 0 ? F.bulbs[2] : F.bulbs[0];
        // animation-delay: i × −0.27 s on a 1.6 s cycle → each bulb starts at its own phase.
        const op = still ? 1 : Animated.modulo(Animated.add(a, (i * 0.27) / 1.6), 1).interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.35, 1] });
        return <Animated.View key={i} style={[{ top: n % 2 === 0 ? 5 : 3, width: 6, height: 8, borderRadius: 3, backgroundColor: color, opacity: op as any }, shadowCss(`0px 0px 6px 2px ${color}`)]} />;
      })}
    </View>
  );
}

/** .fd-diya: lamp (28×12, orange gradient) with an oil rim and a teardrop flame + halo. */
export function Diya() {
  return (
    <View style={[{ width: 28, height: 12, marginTop: 16, borderTopLeftRadius: 2, borderTopRightRadius: 2, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 }, grad(`linear-gradient(180deg, ${F.diyaFrom}, ${F.diyaTo})`)]}>
      <View style={[{ position: "absolute", left: -1, right: -1, top: -2, height: 5, borderRadius: 15 }, grad(`linear-gradient(180deg, ${F.rimFrom}, ${F.rimTo})`)]} />
      <View style={{ position: "absolute", left: 14 - 14, top: -18, width: 28, height: 28, borderRadius: 14, ...grad("radial-gradient(circle, rgba(255, 190, 80, 0.55), transparent 70%)") }} />
      <View style={[{ position: "absolute", left: 14 - 4.5, bottom: 9, width: 9, height: 9, borderTopLeftRadius: 0, borderTopRightRadius: 4.5, borderBottomLeftRadius: 4.5, borderBottomRightRadius: 4.5, transform: [{ rotate: "45deg" }] }, grad(`radial-gradient(circle at 60% 60%, ${F.flame[0]} 0 25%, ${F.flame[1]} 45%, ${F.flame[2]} 85%)`)]} />
    </View>
  );
}

/** .fd-banner: diya · "Happy Diwali 🪔" over "Wishing you light, joy and good health" · diya. Diwali only. */
export function DiwaliBanner() {
  const dark = useIsDark();
  const on = useFestive();
  if (!on) return null;
  const [a, b] = dark ? F.bannerBgDark : F.bannerBg;
  const ink = dark ? F.bannerInkDark : F.bannerInk;
  return (
    <View style={[{ ...row, justifyContent: "center", gap: 14, marginTop: 10, marginHorizontal: 16, paddingTop: 6, paddingBottom: 8, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: dark ? F.bannerBorderDark : F.bannerBorder }, grad(`linear-gradient(90deg, ${a}, ${b} 50%, ${a})`)]}>
      <Diya />
      <View style={{ alignItems: "center" }}>
        <Text style={{ fontSize: 15, lineHeight: 18.75, fontWeight: "800", color: ink }}>Happy Diwali 🪔</Text>
        <Text style={{ fontSize: 12, lineHeight: 15.6, fontWeight: "500", color: ink }}>Wishing you light, joy and good health</Text>
      </View>
      <Diya />
    </View>
  );
}

/** .v2-icon-btn inside the header: 40×40 round, translucent fill, 1 px border (gold-tinted in Diwali). */
function HeaderIcon({ name, onPress, label, festive }: { name: IconName; onPress?: () => void; label: string; festive: boolean }) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} hitSlop={4} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: lit.iconBtnBg, borderWidth: 1, borderColor: festive ? F.iconBorder : lit.iconBtnBorder, alignItems: "center", justifyContent: "center" }}>
      <Icon name={name} size={18} color="#FFFFFF" />
    </Pressable>
  );
}

/**
 * .v2-header. variant "default": logo · location picker · theme · account. variant "page": back · title · theme · account.
 * Diwali (buyer pages only): maroon gradient (darker in dark mode), 2 px gold rule, gold logo and pin, string of lights.
 * The status bar area takes the same background (allowed difference: the web has no status bar).
 */
export function AppHeader({ variant = "default", title, area = "Set location", onLocation, onBack, onTheme, onAccount, seller, safeTop = true, still }: {
  variant?: "default" | "page"; title?: string; area?: string; onLocation?: () => void; onBack?: () => void; onTheme?: () => void; onAccount?: () => void;
  /** Seller dashboard: never festive. */ seller?: boolean; safeTop?: boolean; still?: boolean;
}) {
  const t = useTheme();
  const dark = useIsDark();
  const on = useFestive() && !seller;
  const top = useSafeAreaInsets().top;
  const pad = safeTop ? top : 0;
  return (
    <View style={[{ paddingTop: (on ? 16 : 12) + pad, paddingBottom: 8, paddingHorizontal: 16, backgroundColor: t.brand, overflow: "hidden" }, on ? { borderBottomWidth: 2, borderBottomColor: F.headerBorder } : null, grad(lit.headerGrad(dark, on))]}>
      {on ? <View style={{ position: "absolute", top: pad, left: 0, right: 0, height: 14 }}><DiwaliLights still={still} /></View> : null}
      <View style={[row, { gap: 8, height: 40 }]}>
        {variant === "page" ? (
          <Pressable accessibilityLabel="Back" onPress={onBack} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: lit.backBg, alignItems: "center", justifyContent: "center" }}>
            <Icon name="back" size={20} color="#FFFFFF" />
          </Pressable>
        ) : (
          <Text style={{ fontSize: 19, lineHeight: 19, fontWeight: "800", letterSpacing: -0.57, color: on ? F.logo : "#FFFFFF" }}>Relifish</Text>
        )}
        {variant === "page" ? (
          title === "Relifish"
            ? <View style={{ flex: 1 }}><Text style={{ alignSelf: "flex-start", fontSize: 19, lineHeight: 19, fontWeight: "800", letterSpacing: -0.57, color: on ? F.logo : "#FFFFFF" }}>Relifish</Text></View>
            : <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, lineHeight: lh(14), fontWeight: "700", color: "#FFFFFF" }}>{title}</Text>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Change location" onPress={onLocation} style={[row, { flex: 1, gap: 4 }]}>
            <Icon name="pin" size={14} color={on ? F.logo : "#FFFFFF"} />
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, lineHeight: lh(14), fontWeight: "700", color: "#FFFFFF" }}>{area}</Text>
            <Icon name="chevronDown" size={10} color="#FFFFFF" />
          </Pressable>
        )}
        <HeaderIcon name={dark ? "moon" : "sun"} label="Toggle theme" onPress={onTheme ?? (() => setThemePref(dark ? "light" : "dark"))} festive={on} />
        <HeaderIcon name="user" label="Account" onPress={onAccount ?? (() => router.navigate(seller ? "/partner/profile" : "/account"))} festive={on} />
      </View>
    </View>
  );
}

export type NavItem = { key: string; label: string; icon: "home" | "orders" | "account" | "inventory"; badge?: number };
/** .v2-bottom-nav: 64 px, 1 px top border, soft upward shadow; active item: filled icon in a 40×28 brand-l pill, 700 label. */
export function BottomNav({ items, active, onPress, safeBottom = true }: { items: NavItem[]; active: string; onPress?: (key: string) => void; safeBottom?: boolean }) {
  const t = useTheme();
  const inset = useSafeAreaInsets().bottom;
  const bottom = safeBottom ? inset : 0;
  return (
    <View style={[{ flexDirection: "row", height: 64 + bottom, paddingBottom: bottom, backgroundColor: t.bg, borderTopWidth: 1, borderTopColor: t.border }, shadowCss("0px -4px 16px 0px rgba(0, 0, 0, 0.06)")]}>
      {items.map((it) => {
        const on = it.key === active;
        const color = on ? t.brand : t.ink4;
        return (
          <Pressable key={it.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={it.label} onPress={() => onPress?.(it.key)} style={{ flex: 1, alignItems: "center", paddingTop: on ? 9 : 10 }}>
            <View style={{ width: on ? 42 : 40, height: on ? 29 : 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: on ? t.brandL : "transparent" }}>
              <Icon name={`${it.icon}${on ? "F" : "O"}` as IconName} size={on ? 23 : 22} color={color} />
            </View>
            <Text style={{ marginTop: on ? 3 : 3, fontSize: 12, lineHeight: 12, letterSpacing: 0.12, fontWeight: on ? "700" : "500", color }}>{it.label}</Text>
            {it.badge ? <View style={{ position: "absolute", top: 6, right: "30%", minWidth: 16, height: 16, borderRadius: 8, backgroundColor: t.red, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}><Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "700" }}>{it.badge}</Text></View> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
export const BUYER_NAV: NavItem[] = [{ key: "home", label: "Home", icon: "home" }, { key: "orders", label: "Orders", icon: "orders" }, { key: "account", label: "Account", icon: "account" }];
export const SELLER_NAV: NavItem[] = [{ key: "orders", label: "Orders", icon: "orders" }, { key: "listings", label: "Inventory", icon: "inventory" }, { key: "account", label: "Profile", icon: "account" }];

/** .v2-dash-hero: green gradient, "Good day, {shop}" (12, 90%), "Today's pipeline" (20/800), Stats ▼ pill. */
export function DashboardHero({ shop, statsOpen, onStats, safeTop = true }: { shop: string; statsOpen?: boolean; onStats?: () => void; safeTop?: boolean }) {
  const top = useSafeAreaInsets().top;
  return (
    <View style={[{ padding: 16, paddingTop: 16 + (safeTop ? top : 0), ...row, justifyContent: "space-between" }, grad(lit.dashGrad)]}>
      <View>
        <Text style={{ fontSize: 12, lineHeight: lh(12), color: "#FFFFFF", opacity: 0.9 }}>Good day, {shop}</Text>
        <Text style={{ marginTop: 2, fontSize: 20, lineHeight: lh(20), fontWeight: "800", color: "#FFFFFF" }}>Today's pipeline</Text>
      </View>
      <Pressable onPress={onStats} style={{ backgroundColor: "rgba(255, 255, 255, 0.2)", borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 }}>
        <Text style={{ fontSize: 11, lineHeight: lh(11), fontWeight: "600", color: "#FFFFFF" }}>Stats {statsOpen ? "▲" : "▼"}</Text>
      </Pressable>
    </View>
  );
}

/** .v2-dash-tabs + search + filter bar (Range, Type, CSV, "N pending"). Selects open the given pickers. */
export function DashboardTabs({ tabs, active, onTab, search, onSearch, range, type, onRange, onType, onCsv, countText }: {
  tabs: { key: string; label: string; count?: number }[]; active: string; onTab: (k: string) => void;
  search: string; onSearch: (s: string) => void; range: string; type: string; onRange: () => void; onType: () => void; onCsv: () => void; countText: string;
}) {
  const t = useTheme();
  const sel = { backgroundColor: t.bg2, borderWidth: 1, borderColor: t.border, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8 };
  return (
    <View style={[{ backgroundColor: t.bg }, shadowCss("0px 4px 10px 0px rgba(15, 23, 42, 0.08)")]}>
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: t.border }}>
        {tabs.map((x) => {
          const on = x.key === active;
          return (
            <Pressable key={x.key} onPress={() => onTab(x.key)} style={[row, { flex: 1, justifyContent: "center", gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: on ? t.brand : "transparent", marginBottom: -1 }]}>
              <Text style={{ fontSize: 12, lineHeight: lh(12), fontWeight: "600", color: on ? t.brand : t.ink3 }}>{x.label}</Text>
              {x.count != null ? <View style={{ backgroundColor: t.red, borderRadius: 9999, paddingVertical: 1, paddingHorizontal: 6 }}><Text style={{ fontSize: 10, lineHeight: 12, fontWeight: "600", color: "#FFFFFF" }}>{x.count}</Text></View> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={{ paddingVertical: 8, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: t.border }}>
        <TextInput value={search} onChangeText={onSearch} placeholder="Search by order ID or last 4 phone digits" placeholderTextColor={t.ink4} style={{ height: 34, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 0, fontSize: 13, color: t.ink, fontFamily: "Inter_400Regular" }} />
      </View>
      <View style={{ paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: t.border, gap: 6 }}>
        <View style={[row, { gap: 6, flexWrap: "wrap" }]}>
          <Text style={{ fontSize: 11, fontWeight: "600", color: t.ink3 }}>Range:</Text>
          <Pressable onPress={onRange} style={sel}><Text style={{ fontSize: 11, fontWeight: "600" }}>{range} ▾</Text></Pressable>
          <Text style={{ fontSize: 11, fontWeight: "600", color: t.ink3, marginLeft: 6 }}>Type:</Text>
          <Pressable onPress={onType} style={sel}><Text style={{ fontSize: 11, fontWeight: "600" }}>{type} ▾</Text></Pressable>
          <Pressable onPress={onCsv} style={sel}><Text style={{ fontSize: 11, fontWeight: "600", color: t.brand }}>Export CSV</Text></Pressable>
        </View>
        <Text style={{ fontSize: 11, fontWeight: "600", color: t.ink3 }}>{countText}</Text>
      </View>
    </View>
  );
}
