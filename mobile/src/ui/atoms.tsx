/**
 * Atoms + molecules from src/components/ui/atoms and /molecules (Button, Input, PhoneInput, OTPInput, Textarea, Spinner,
 * Skeleton, Progress, SlotPicker, AddressCard, EmptyState, ErrorState, PermissionPrompt, CartBar, PreorderBanner hero/empty,
 * Toast) and the sheet header + step bar of BottomSheet / CheckoutSheet. Values from public/design-system/live.html.
 */
import { forwardRef, useRef } from "react";
import { ActivityIndicator, Pressable, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { lit, useIsDark, useTheme } from "../theme";
import { grad, lh, row, shadowCss, Text } from "./base";

/** .v2-btn: primary / secondary / ghost / danger; sm 13/700 (8/16 pad) · md 14/700 (12/24) · lg 16/800 (14/32); min 44 tall; 8 radius. */
export function Button({ title, onPress, variant = "primary", size = "md", disabled, loading, full, style, color, textColor }: {
  title: string; onPress?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg";
  disabled?: boolean; loading?: boolean; full?: boolean; style?: ViewStyle; /** fill colour override (e.g. orange on PermissionPrompt) */ color?: string; textColor?: string;
}) {
  const t = useTheme();
  const v = { primary: [color ?? t.brand, "#FFFFFF", null], secondary: [t.bg, t.brand, t.brand], ghost: ["transparent", t.ink, null], danger: [t.red, "#FFFFFF", null] }[variant] as [string, string, string | null];
  const z = { sm: [8, 16, 13, "700"], md: [12, 24, 14, "700"], lg: [14, 32, 16, "800"] }[size] as [number, number, number, string];
  return (
    <Pressable accessibilityRole="button" disabled={disabled || loading} onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress?.(); }}
      style={({ pressed }) => [{ minHeight: size === "lg" ? 52 : 44, paddingVertical: z[0], paddingHorizontal: z[1], borderRadius: 8, backgroundColor: v[0], borderWidth: v[2] ? 1 : 0, borderColor: v[2] ?? "transparent", ...row, justifyContent: "center", gap: 8, alignSelf: full ? "stretch" : "flex-start", opacity: disabled || loading ? 0.4 : pressed ? 0.88 : 1 }, style]}>
      {loading ? <ActivityIndicator size="small" color={v[1]} /> : null}
      <Text style={{ fontSize: z[2], lineHeight: lh(z[2]), fontWeight: z[3] as any, color: textColor ?? v[1] }}>{title}</Text>
    </Pressable>
  );
}

/** .v2-field: label 12/600 ink-2 (+ red *) · 46 px input (1 px border, 8 radius, 12/14 pad) · helper 11 (error red / success green). */
export const Input = forwardRef<any, TextInputProps & { label?: string; required?: boolean; helper?: string; error?: string; success?: string; prefix?: string; multiline?: boolean }>(
  function Input({ label, required, helper, error, success, prefix, multiline, style, ...rest }, ref) {
    const t = useTheme();
    const border = error ? t.red : success ? t.green : t.border;
    return (
      <View>
        {label ? <Text style={{ marginBottom: 6, fontSize: 12, lineHeight: lh(12), fontWeight: "600", color: t.ink2 }}>{label}{required ? <Text style={{ color: t.red, fontWeight: "600" }}> *</Text> : null}</Text> : null}
        <View style={[row, { minHeight: multiline ? 94 : 46, borderWidth: 1, borderColor: border, borderRadius: 8, backgroundColor: t.bg, overflow: "hidden", alignItems: multiline ? "flex-start" : "center" }]}>
          {prefix ? <View style={{ alignSelf: "stretch", justifyContent: "center", paddingVertical: 12, paddingLeft: 14, paddingRight: 10, backgroundColor: t.bg2 }}><Text style={{ fontSize: 14, lineHeight: lh(14), fontWeight: "600", color: t.ink2 }}>{prefix}</Text></View> : null}
          <TextInput ref={ref} placeholderTextColor={t.ink4} multiline={multiline} {...rest}
            style={[{ flex: 1, paddingVertical: 12, paddingHorizontal: 14, fontSize: 14, color: t.ink, fontFamily: "Inter_400Regular", textAlignVertical: multiline ? "top" : "center", minHeight: multiline ? 94 : 44 }, style]} />
        </View>
        {error || success || helper ? <Text style={{ marginTop: 4, fontSize: 11, lineHeight: lh(11), color: error ? t.red : success ? t.green : t.ink4 }}>{error || success || helper}</Text> : null}
      </View>
    );
  },
);
/** PhoneInput: Input with the +91 prefix, 10 digits, phone keypad. */
export const PhoneInput = forwardRef<any, TextInputProps & { label?: string; error?: string; helper?: string }>(function PhoneInput({ label = "Phone number", ...p }, ref) {
  return <Input ref={ref} label={label} required prefix="+91" keyboardType="phone-pad" maxLength={14} placeholder="98XXX XXXXX" textContentType="telephoneNumber" autoComplete="tel" {...p} />;
});

/**
 * .v2-otp: 6 cells 44×52 (8 gap, 1 px border, focus brand), helper under. One hidden input owns the value, so paste, the
 * Android SMS code suggestion (autoComplete sms-otp) and iOS oneTimeCode all fill every cell; onComplete fires at 6.
 */
export function OTPInput({ value, onChange, onComplete, helper, error, autoFocus = true, cell = 44, gap = 8 }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; helper?: string; error?: string; autoFocus?: boolean; cell?: number; gap?: number }) {
  const t = useTheme();
  const ref = useRef<any>(null);
  return (
    <View>
      <Pressable onPress={() => ref.current?.focus()} style={[row, { justifyContent: "center", gap }]}>
        {Array.from({ length: 6 }, (_, i) => {
          const focus = i === Math.min(value.length, 5);
          return (
            <View key={i} style={[{ width: cell, height: cell + 8, borderRadius: cell > 44 ? 12 : 8, borderWidth: focus ? 1.5 : 1, borderColor: error ? t.red : focus ? t.brand : value[i] ? t.ink3 : t.border, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }, focus ? shadowCss(`0px 0px 0px 3px ${t.brandL}`) : null]}>
              <Text style={{ fontSize: 22, lineHeight: lh(22), fontWeight: "800" }}>{value[i] ?? ""}</Text>
            </View>
          );
        })}
      </Pressable>
      <TextInput ref={ref} value={value} autoFocus={autoFocus} keyboardType="number-pad" maxLength={6} textContentType="oneTimeCode" autoComplete="sms-otp"
        onChangeText={(v) => { const d = v.replace(/\D/g, "").slice(0, 6); onChange(d); if (d.length === 6) onComplete?.(d); }}
        caretHidden style={{ position: "absolute", left: 0, right: 0, top: 0, height: cell + 8, opacity: 0.01, color: "transparent" }} />
      {error || helper ? <Text style={{ marginTop: 4, textAlign: "center", fontSize: 11, lineHeight: lh(11), color: error ? t.red : t.ink4 }}>{error || helper}</Text> : null}
    </View>
  );
}

/** .v2-spinner: 4 px ring (brand-l track, brand top). */
export function Spinner({ size = 36, color }: { size?: number; color?: string }) {
  const t = useTheme();
  return <ActivityIndicator size={size > 30 ? "large" : "small"} color={color ?? t.brand} />;
}
/** .v2-skeleton: shimmer block; card 12 radius, line 6, circle. */
export function Skeleton({ width = "100%", height = 16, radius = 6 }: { width?: number | `${number}%`; height?: number; radius?: number }) {
  const t = useTheme();
  const dark = useIsDark();
  return <View style={[{ width, height, borderRadius: radius }, grad(dark ? `linear-gradient(90deg, ${t.bg3} 0%, ${t.bg3} 50%, ${t.bg3} 100%)` : `linear-gradient(90deg, ${t.bg3} 0%, ${t.border} 50%, ${t.bg3} 100%)`)]} />;
}
/** .v2-progress: 6 px pill track (bg-3) + fill (brand / green / orange). */
export function Progress({ value, color }: { value: number; color?: "brand" | "green" | "orange" }) {
  const t = useTheme();
  return <View style={{ height: 6, borderRadius: 999, backgroundColor: t.bg3, overflow: "hidden" }}><View style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: 6, borderRadius: 999, backgroundColor: color === "green" ? t.green : color === "orange" ? t.orange : t.brand }} /></View>;
}

export type Slot = { id: string; time: string; label?: string; fee?: number; disabled?: boolean };
/** .v2-slot-grid: 3 columns, 8 gap; tile 12 pad, 8 radius; time 13/700, label 10/500, fee 9/700 green; selected brand-l + brand border. */
export function SlotPicker({ title, slots, selected, onPick }: { title?: string; slots: Slot[]; selected?: string; onPick: (id: string) => void }) {
  const t = useTheme();
  return (
    <View>
      {title ? <Text style={{ marginBottom: 8, fontSize: 12, lineHeight: lh(12), fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: t.ink3 }}>{title}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {slots.map((s) => {
          const on = s.id === selected;
          return (
            <Pressable key={s.id} disabled={s.disabled} onPress={() => onPick(s.id)} style={{ width: "31.8%", padding: 12, borderRadius: 8, borderWidth: 1, borderColor: on ? t.brand : t.border, backgroundColor: on ? t.brandL : t.bg, opacity: s.disabled ? 0.4 : 1, alignItems: "center", justifyContent: "center", minHeight: 56 }}>
              <Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "700", color: on ? t.brand : t.ink }}>{s.time}</Text>
              {s.label || s.disabled ? <Text style={{ marginTop: 2, fontSize: 10, lineHeight: lh(10), fontWeight: "500", color: s.disabled ? t.red : t.ink3 }}>{s.disabled ? "Sold out" : s.label}</Text> : null}
              {s.fee ? <Text style={{ marginTop: 2, fontSize: 9, lineHeight: lh(9), fontWeight: "700", color: t.green }}>+₹{s.fee}</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** .v2-addr-card: 40 px icon tile · label 13/700 + DEFAULT 9/600 pill · text 12 · 20 px radio; selected brand-l + brand border. */
export function AddressCard({ label, type, text, isDefault, selected, onPress, right }: { label: string; type: "home" | "office" | "other"; text: string; isDefault?: boolean; selected?: boolean; onPress?: () => void; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={[row, { gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: selected ? t.brand : t.border, backgroundColor: selected ? t.brandL : t.bg }]}>
      <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: selected ? t.brand : t.bg3, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 20 }}>{type === "home" ? "🏠" : type === "office" ? "🏢" : "📍"}</Text></View>
      <View style={{ flex: 1 }}>
        <View style={[row, { gap: 8 }]}>
          <Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "700" }}>{label}</Text>
          {isDefault ? <View style={{ backgroundColor: t.greenL, borderRadius: 4, paddingVertical: 2, paddingHorizontal: 6 }}><Text style={{ fontSize: 9, lineHeight: lh(9), letterSpacing: 0.45, fontWeight: "600", textTransform: "uppercase", color: t.green }}>Default</Text></View> : null}
        </View>
        <Text style={{ marginTop: 3, fontSize: 12, lineHeight: 17.4, color: t.ink3 }}>{text}</Text>
      </View>
      {right ?? <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: selected ? t.brand : t.ink4, alignItems: "center", justifyContent: "center" }}>{selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.brand }} /> : null}</View>}
    </Pressable>
  );
}

/** .v2-empty: card 40/24 pad, 56 px icon, title 17/800, desc 13 (19.5), primary CTA (+ ghost / call us). */
export function EmptyState({ icon, title, desc, cta, onCta, ghost, onGhost }: { icon: string; title: string; desc?: string; cta?: string; onCta?: () => void; ghost?: string; onGhost?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ marginHorizontal: 16, alignItems: "center", paddingVertical: 40, paddingHorizontal: 24, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, borderRadius: 12 }}>
      <Text style={{ fontSize: 56, lineHeight: 74 }}>{icon}</Text>
      <Text style={{ marginTop: 16, fontSize: 17, lineHeight: lh(17), fontWeight: "800", textAlign: "center" }}>{title}</Text>
      {desc ? <Text style={{ marginTop: 12, fontSize: 13, lineHeight: 19.5, color: t.ink3, textAlign: "center" }}>{desc}</Text> : null}
      {cta ? <Button title={cta} onPress={onCta} style={{ marginTop: 20, alignSelf: "center" }} /> : null}
      {ghost ? <Pressable onPress={onGhost} style={{ marginTop: 12 }}><Text style={{ fontSize: 13, fontWeight: "700", color: t.link }}>{ghost}</Text></Pressable> : null}
    </View>
  );
}

/** .v2-err-card (warning / danger): tinted head (36 px icon tile, title 14/700, desc 12) + actions row (ghost + primary sm). */
export function ErrorState({ icon, title, desc, primary, onPrimary, secondary, onSecondary, danger }: { icon: string; title: string; desc: string; primary: string; onPrimary?: () => void; secondary?: string; onSecondary?: () => void; danger?: boolean }) {
  const t = useTheme();
  const tone = danger ? [t.redL, t.red, "#991B1B", "#FECACA"] : [t.orangeL, t.orange, "#9A3412", "#FED7AA"];
  return (
    <View style={{ marginHorizontal: 16, backgroundColor: t.bg, borderWidth: 1, borderColor: tone[3], borderRadius: 12, overflow: "hidden" }}>
      <View style={[row, { alignItems: "flex-start", gap: 12, padding: 16, backgroundColor: tone[0] }]}>
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: tone[1], alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 18, color: "#FFFFFF" }}>{icon}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, lineHeight: lh(14), fontWeight: "700", color: tone[2] }}>{title}</Text>
          <Text style={{ marginTop: 3, fontSize: 12, lineHeight: 17.4, color: t.ink2 }}>{desc}</Text>
        </View>
      </View>
      <View style={[row, { gap: 8, paddingVertical: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: t.border }]}>
        {secondary ? <Button title={secondary} variant="ghost" size="sm" onPress={onSecondary} style={{ flex: 1 }} /> : null}
        <Button title={primary} size="sm" onPress={onPrimary} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

/** .v2-prompt: 72 px icon circle, title 17/800, desc 13, ✓ benefits 12/500, Allow (filled) + Maybe later (ghost). */
export function PermissionPrompt({ icon, title, desc, benefits, allow, skip, onAllow, onSkip, orange }: { icon: string; title: string; desc: string; benefits: string[]; allow: string; skip: string; onAllow?: () => void; onSkip?: () => void; orange?: boolean }) {
  const t = useTheme();
  const dark = useIsDark();
  return (
    <View style={[{ marginHorizontal: 16, padding: 24, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, borderRadius: 16 }, shadowCss(dark ? "0px 4px 6px 0px rgba(0, 0, 0, 0.35), 0px 2px 4px 0px rgba(0, 0, 0, 0.2)" : "0px 4px 6px 0px rgba(0, 0, 0, 0.07), 0px 2px 4px 0px rgba(0, 0, 0, 0.06)")]}>
      <View style={{ alignSelf: "center", width: 72, height: 72, borderRadius: 36, backgroundColor: orange ? t.orangeL : t.brandL, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 36 }}>{icon}</Text></View>
      <Text style={{ marginTop: 16, fontSize: 17, lineHeight: lh(17), fontWeight: "800", textAlign: "center" }}>{title}</Text>
      <Text style={{ marginTop: 6, fontSize: 13, lineHeight: 19.5, color: t.ink2, textAlign: "center" }}>{desc}</Text>
      <View style={{ marginTop: 20 }}>{benefits.map((b) => <Text key={b} style={{ paddingVertical: 6, fontSize: 12, lineHeight: lh(12), fontWeight: "500", color: t.ink2 }}><Text style={{ color: t.green, fontWeight: "700" }}>✓  </Text>{b}</Text>)}</View>
      <Button title={allow} full color={orange ? t.orange : undefined} onPress={onAllow} style={{ marginTop: 20 }} />
      <Button title={skip} full variant="ghost" onPress={onSkip} style={{ marginTop: 8 }} />
    </View>
  );
}

/** .v2-cart-bar: 12 radius bar (brand / orange below minimum / green free delivery / indigo pre-order): line + total, white pill CTA. */
export function CartBar({ line, total, cta, tone = "brand", onPress }: { line: string; total: string; cta: string; tone?: "brand" | "orange" | "green" | "indigo"; onPress?: () => void }) {
  const t = useTheme();
  const dark = useIsDark();
  const bg = { brand: t.brand, orange: t.orange, green: t.green, indigo: t.indigo }[tone];
  return (
    <Pressable onPress={onPress} style={[row, { alignSelf: "center", gap: 12, borderRadius: 12, backgroundColor: bg, paddingVertical: 12, paddingHorizontal: 16 }, shadowCss(dark ? "0px 10px 15px 0px rgba(0, 0, 0, 0.4), 0px 4px 6px 0px rgba(0, 0, 0, 0.25)" : "0px 10px 15px 0px rgba(0, 0, 0, 0.1), 0px 4px 6px 0px rgba(0, 0, 0, 0.05)")]}>
      <View>
        <Text style={{ fontSize: 12, lineHeight: lh(12), fontWeight: "600", color: "#FFFFFF", opacity: 0.9 }}>{line}</Text>
        <Text style={{ marginTop: 2, fontSize: 16, lineHeight: lh(16), fontWeight: "800", color: "#FFFFFF" }}>{total}</Text>
      </View>
      <View style={{ backgroundColor: dark ? t.bg : "#FFFFFF", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 }}><Text style={{ fontSize: 12, lineHeight: lh(12), fontWeight: "700", color: bg }}>{cta}</Text></View>
    </Pressable>
  );
}

/** PreorderBanner hero (indigo→purple, 22/800 title, white CTA) and empty (cream, 💡) variants. */
export function PreorderBannerHero({ variant = "hero", title = "Pre-order fresh fish", desc = "Pre-order for tomorrow or later · pick a delivery time", cta = "Browse", onPress }: { variant?: "hero" | "empty"; title?: string; desc?: string; cta?: string; onPress?: () => void }) {
  const t = useTheme();
  if (variant === "empty") return (
    <View style={[row, { marginHorizontal: 16, gap: 12, padding: 16, borderRadius: 12 }, grad("linear-gradient(135deg, #FFF7ED, #FEF3C7)")]}>
      <Text style={{ fontSize: 32, lineHeight: 42 }}>💡</Text>
      <View style={{ flex: 1 }}><Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "700", color: "#92400E" }}>{title}</Text><Text style={{ marginTop: 2, fontSize: 11, lineHeight: 16.5, color: t.amber }}>{desc}</Text></View>
    </View>
  );
  return (
    <Pressable onPress={onPress} style={[{ marginHorizontal: 16, padding: 20, borderRadius: 16 }, grad("linear-gradient(135deg, #4F46E5, #7C3AED)")]}>
      <Text style={{ fontSize: 22, lineHeight: 26.4, fontWeight: "800", color: "#FFFFFF" }}>{title}</Text>
      <Text style={{ marginTop: 6, fontSize: 13, lineHeight: 19.5, color: "#FFFFFF", opacity: 0.9 }}>{desc}</Text>
      <View style={{ marginTop: 14, alignSelf: "flex-start", backgroundColor: "#FFFFFF", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 20 }}><Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "700", color: t.indigo }}>{cta} →</Text></View>
    </Pressable>
  );
}

/** .v2-toast: 12 radius, 12/16 pad, icon, title 13/600 + desc 11 (85%), ×; success green / error red / warning orange / info brand. */
export function Toast({ variant = "success", title, desc, onClose }: { variant?: "success" | "error" | "warning" | "info"; title: string; desc?: string; onClose?: () => void }) {
  const t = useTheme();
  const bg = { success: t.green, error: t.red, warning: t.orange, info: t.brand }[variant];
  return (
    <View style={[row, { marginHorizontal: 16, gap: 10, borderRadius: 12, backgroundColor: bg, paddingVertical: 12, paddingHorizontal: 16 }, shadowCss("0px 10px 15px 0px rgba(0, 0, 0, 0.1), 0px 4px 6px 0px rgba(0, 0, 0, 0.05)")]}>
      <Text style={{ fontSize: 18, lineHeight: 18, fontWeight: "500", color: "#FFFFFF" }}>{variant === "success" ? "✓" : variant === "error" ? "✕" : variant === "warning" ? "!" : "i"}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "600", color: "#FFFFFF" }}>{title}</Text>
        {desc ? <Text style={{ marginTop: 1, fontSize: 11, lineHeight: lh(11), color: "#FFFFFF", opacity: 0.85 }}>{desc}</Text> : null}
      </View>
      <Pressable onPress={onClose} hitSlop={8}><Text style={{ fontSize: 18, lineHeight: 18, color: "rgba(255, 255, 255, 0.6)" }}>×</Text></Pressable>
    </View>
  );
}

/** .v2-sheet-head: handle (36×4) above, title 17/800, ×, 1 px rule. */
export function SheetHeader({ title, onClose, handle = true }: { title: string; onClose?: () => void; handle?: boolean }) {
  const t = useTheme();
  return (
    <View>
      {handle ? <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: t.border, marginTop: 8 }} /> : null}
      <View style={[row, { justifyContent: "space-between", paddingTop: 12, paddingBottom: 16, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: t.border }]}>
        <Text style={{ fontSize: 17, lineHeight: lh(17), fontWeight: "800" }}>{title}</Text>
        {onClose ? <Pressable accessibilityLabel="Close" onPress={onClose} hitSlop={10}><Text style={{ fontSize: 24, lineHeight: 24, color: t.ink3 }}>×</Text></Pressable> : null}
      </View>
    </View>
  );
}
/** .v2-co-steps: two 4 px bars, 8 gap; active brand, idle bg-3. */
export function StepBar({ step, steps = 2 }: { step: number; steps?: number }) {
  const t = useTheme();
  return <View style={{ flexDirection: "row", gap: 8, marginHorizontal: 16 }}>{Array.from({ length: steps }, (_, i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? t.brand : t.bg3 }} />)}</View>;
}
void lit;
