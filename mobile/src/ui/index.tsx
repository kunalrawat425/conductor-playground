/**
 * The website's components (src/styles/components.css + seller page styles) in React Native.
 * Sizes, weights and radii are the site's computed values (stage.relifish.com, 6 Nov 2026);
 * every colour comes from the generated tokens (npm run tokens). Never hard-code a colour here.
 */
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text as RNText, View, type TextProps, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { festive, font, radius, shadow, useFestive, useTheme, type Theme } from "../theme";
import { tokens } from "../theme/tokens";

const WEB_FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'; // --v2-font in src/styles/tokens.css

/** Text in Inter: fontWeight in the style picks the Inter family (one family per weight in RN). */
export function Text(props: TextProps) {
  const t = useTheme();
  const st = (StyleSheet.flatten(props.style) || {}) as any;
  const w = ({ normal: 400, bold: 700 } as any)[st.fontWeight] ?? (Number(st.fontWeight) || 400);
  const { fontWeight: _w, ...rest } = st;
  // On the web the weight is kept too, so fallback fonts (Marathi names) render bold like the site; on Android a
  // weight next to a custom family can drop it back to Roboto.
  const family = (tokens.font as any)[w] ?? tokens.font[400];
  // Web: the site's fallback stack after Inter, so glyphs Inter lacks (✓, Marathi) come from the same fonts.
  return <RNText {...props} style={[{ color: t.ink }, rest, Platform.OS === "web" ? { fontFamily: `${family}, ${WEB_FALLBACK}`, fontWeight: String(w) as any } : { fontFamily: family }]} />;
}

/** .v2-btn: primary / secondary / ghost / danger; sm 36 px, md 44 px, lg = checkout bar (52 px, 12 radius, 15/800). */
export function Button({ title, onPress, kind = "primary", size = "md", disabled, loading, style, textColor }: {
  title: string; onPress: () => void; kind?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg";
  disabled?: boolean; loading?: boolean; style?: ViewStyle; textColor?: string;
}) {
  const t = useTheme();
  const v = {
    primary: { bg: t.brand, fg: t.onBrand, border: t.brand },
    secondary: { bg: t.card, fg: t.brand, border: t.brand },
    ghost: { bg: "transparent", fg: t.ink, border: "transparent" },
    danger: { bg: t.card, fg: t.red, border: t.redL },
  }[kind];
  const z = { sm: { h: 36, px: 16, fs: 13, w: 700, r: radius.sm }, md: { h: 44, px: 24, fs: 14, w: 700, r: radius.sm }, lg: { h: 52, px: 14, fs: 15, w: 800, r: radius.base } }[size];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => [{ minHeight: z.h, paddingHorizontal: z.px, borderRadius: z.r, backgroundColor: v.bg, borderColor: v.border, borderWidth: kind === "secondary" || kind === "danger" ? 1.5 : 0, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={textColor ?? v.fg} /> : <Text style={{ color: textColor ?? v.fg, fontSize: z.fs, fontWeight: z.w as any }}>{title}</Text>}
    </Pressable>
  );
}

/** Card surface: 12 px radius (menu items) or 16 px (seller cards); gold border while the site is festive. */
export function Card({ children, style, big, testID }: { children: React.ReactNode; style?: ViewStyle; big?: boolean; testID?: string }) {
  const t = useTheme();
  const on = useFestive();
  const gold = big && on;
  return <View testID={testID} style={[{ backgroundColor: t.card, borderRadius: big ? radius.lg : radius.base, borderWidth: 1, borderColor: gold ? festive.headerBorder : t.border, padding: 14, marginHorizontal: 16, marginTop: 12 }, shadow.sm as any, style]}>{children}</View>;
}

export function Label({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[s.label, { color: t.ink3 }]}>{children}</Text>;
}

/** Badges: preorder (.v2-item-cut), off (.v2-off), popular (.v2-pop), and order-status pills (.v2-oc-badge tones). */
export function Badge({ text, kind = "grey" }: { text: string; kind?: "preorder" | "off" | "popular" | "grey" | "green" | "amber" | "red" | "blue" | "purple" }) {
  const t = useTheme();
  const tone: Record<string, [string, string]> = {
    grey: [t.bg3, t.ink2], green: [t.greenBg, t.green], amber: [t.amberSoft, t.amber], red: [t.redSoft, t.red], blue: [t.brandSoft, t.brand], purple: [t.purpleSoft, t.purple],
  };
  if (kind === "preorder") return <View style={[s.badge, { backgroundColor: t.purpleSoft, borderRadius: radius.xs, paddingVertical: 2, paddingHorizontal: 6 }]}><Text style={{ color: t.purple, fontSize: 11, lineHeight: 11, fontWeight: "600" }}>{text}</Text></View>;
  if (kind === "off") return <View style={[s.badge, { backgroundColor: t.brand, borderRadius: 5, paddingVertical: 2, paddingHorizontal: 6 }]}><Text style={{ color: t.onBrand, fontSize: 11, fontWeight: "800", letterSpacing: 0.22 }}>{text}</Text></View>;
  if (kind === "popular") return <View style={[s.badge, { backgroundColor: t.orange, borderRadius: 5, paddingVertical: 3, paddingHorizontal: 8 }]}><Text style={{ color: t.onBrand, fontSize: 11, lineHeight: 13.2, fontWeight: "800", letterSpacing: 0.44 }}>{text}</Text></View>;
  const [bg, fg] = tone[kind];
  return <View style={[s.badge, { backgroundColor: bg, borderRadius: 20, paddingVertical: 3, paddingHorizontal: 8 }]}><Text style={{ color: fg, fontSize: 10, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" }}>{text}</Text></View>;
}

export function HeaderBackground({ plain }: { plain?: boolean } = {}) {
  const t = useTheme();
  const on = useFestive();
  if (plain || !on) return <View style={{ flex: 1, backgroundColor: t.brand }} />;
  return <LinearGradient colors={[festive.headerFrom, festive.headerTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, borderBottomWidth: 2, borderBottomColor: festive.headerBorder }} />;
}
export const headerTitleStyle = { ...font(800), fontSize: 19, lineHeight: 19, letterSpacing: -0.57 };

export function Loading() {
  const t = useTheme();
  return <View style={[s.center, { backgroundColor: t.page }]}><ActivityIndicator color={t.brand} size="large" /></View>;
}

export type { Theme };
export const s = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8 },
  badge: { alignSelf: "flex-start" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  h1: { fontSize: 20, fontWeight: "800" },
  h2: { fontSize: 15, fontWeight: "800" },
  body: { fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center" },
});

/** Status pill (order list / checkout): the site's .v2-oc-badge tones. */
