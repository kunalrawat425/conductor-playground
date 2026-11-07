/** Seller dashboard parts, from pages/dashboard/orders, /listings and /profile. Values from public/design-system/live.html. */
import { Image, Pressable, View } from "react-native";
import { useIsDark, useTheme } from "../theme";
import { lh, row, shadowCss, Text } from "./base";
import { Button } from "./atoms";
import { Icon } from "./icons";

export type OcBadge = { text: string; tone: "paid" | "urgent" | "done" | "new" | "preorder" | "ready" | "grey" };
/** .v2-oc-badge: 10/700 caps pill (paid green, urgent orange, ready brand, done grey, preorder purple). */
export function OcBadge({ b }: { b: OcBadge }) {
  const t = useTheme();
  const c: Record<OcBadge["tone"], [string, string]> = {
    paid: ["#DCFCE7", t.green], urgent: ["#FED7AA", t.orange], done: [t.bg3, t.ink3], new: [t.brandL, t.brand], preorder: [t.purpleL, t.purple], ready: [t.brandL, t.brand], grey: [t.bg3, t.ink2],
  };
  return <View style={{ backgroundColor: c[b.tone][0], borderRadius: 20, paddingVertical: 3, paddingHorizontal: 8 }}><Text style={{ fontSize: 10, lineHeight: lh(10), letterSpacing: 0.4, fontWeight: "700", textTransform: "uppercase", color: c[b.tone][1] }}>{b.text}</Text></View>;
}

export type OcLine = { text: string; price: string; badge?: OcBadge; struck?: boolean; refund?: { title: string; text: string; cta?: string; onCta?: () => void } };
export type OcAction = { title: string; kind: "primary" | "danger" | "secondary" | "green" | "ghost"; onPress?: () => void; disabled?: boolean };
/**
 * .v2-seller-order (dashboard/orders): header (#ID · last 4, time, badges), "n items" strip, lines (option/cut, price, per-line
 * badge, struck when cancelled, refund box), SAME DAY / DELIVERY tags, location, total, payment + ref, Next note, paid line, actions.
 */
export function SellerOrderCard({ id, time, badges, itemsLine, lines, tags, location, locationNote, total, payment, paymentRef, next, paidLine, actions, extra, waiting, paid }: {
  id: string; time: string; badges: OcBadge[]; itemsLine?: string; lines: OcLine[]; tags: { text: string; kind: "order" | "preorder" | "delivery" | "pickup" }[];
  location?: string; locationNote?: string; total: string; payment?: string; paymentRef?: string; next?: string; paidLine?: string; actions: OcAction[]; extra?: React.ReactNode;
  /** Fast-accept card (preview): orange left rule, "Waiting m:ss" since the order came in, "Paid ₹" pill. */ waiting?: string; paid?: string;
}) {
  const t = useTheme();
  const dark = useIsDark();
  const tag = { order: ["#EFF6FF", "#1D4ED8", "#BFDBFE"], preorder: [t.purpleL, t.purple, "#DDD6FE"], delivery: ["#ECFEFF", "#0E7490", "#A5F3FC"], pickup: ["#FEF3C7", "#92400E", "#FDE68A"] };
  return (
    <View style={[{ marginHorizontal: 24, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: dark ? "rgb(76, 88, 105)" : "rgb(229, 235, 242)", backgroundColor: t.bg, gap: 8 }, waiting ? { borderLeftWidth: 4, borderLeftColor: t.orange } : null, shadowCss("0px 8px 18px 0px rgba(15, 23, 42, 0.06)")]}>
      {waiting ? (
        <View style={[row, { justifyContent: "space-between" }]}>
          <View style={[row, { gap: 6 }]}><Icon name="clock" size={15} color={t.orange} /><Text style={{ fontSize: 13, fontWeight: "800", color: t.orange }}>Waiting {waiting}</Text></View>
          {paid ? <View style={{ backgroundColor: t.greenL, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 8 }}><Text style={{ fontSize: 12, fontWeight: "700", color: t.green }}>Paid {paid}</Text></View> : null}
        </View>
      ) : null}
      <View style={[row, { justifyContent: "space-between", alignItems: "flex-start" }]}>
        <View><Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "700" }}>{id}</Text><Text style={{ marginTop: 1, fontSize: 11, lineHeight: lh(11), color: t.ink3 }}>{time}</Text></View>
        <View style={[row, { gap: 5, flexShrink: 1, flexWrap: "wrap", justifyContent: "flex-end" }]}>{badges.map((b, i) => <OcBadge key={i} b={b} />)}</View>
      </View>
      {itemsLine ? <View style={{ backgroundColor: t.bg2, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 }}><Text style={{ fontSize: 12, lineHeight: 16.8, color: t.ink2 }}>{itemsLine}</Text></View> : null}
      <View style={{ marginTop: -4 }}>
        {lines.map((l, i) => (
          <View key={i} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.border }}>
            <View style={[row, { gap: 8 }]}>
              <Text style={{ flex: 1, fontSize: 13, lineHeight: lh(13), fontWeight: "600", textTransform: "capitalize", color: l.struck ? t.ink3 : t.ink, textDecorationLine: l.struck ? "line-through" : "none" }}>{l.text}</Text>
              <Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "700" }}>{l.price}</Text>
              {l.badge ? <OcBadge b={l.badge} /> : null}
            </View>
            {l.refund ? (
              <View style={{ marginTop: 6, backgroundColor: t.orangeL, borderWidth: 1, borderColor: "#FED7AA", borderRadius: 8, padding: 10 }}>
                <Text style={{ fontSize: 12, lineHeight: lh(12), fontWeight: "700", color: t.orange }}>{l.refund.title}</Text>
                <Text style={{ marginTop: 6, fontSize: 11, lineHeight: lh(11), color: t.ink3 }}>{l.refund.text}</Text>
                {l.refund.cta ? <Pressable onPress={l.refund.onCta} style={{ marginTop: 6, height: 36, borderRadius: 8, borderWidth: 1, borderColor: "#FED7AA", backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 13, fontWeight: "700", color: t.orange }}>{l.refund.cta}</Text></Pressable> : null}
              </View>
            ) : null}
          </View>
        ))}
      </View>
      {tags.length ? <View style={[row, { gap: 6 }]}>{tags.map((x, i) => <View key={i} style={{ backgroundColor: dark ? t.bg3 : tag[x.kind][0], borderWidth: 1, borderColor: dark ? t.border : tag[x.kind][2], borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 }}><Text style={{ fontSize: 10, lineHeight: lh(10), letterSpacing: 0.3, fontWeight: "700", textTransform: "uppercase", color: dark ? t.ink2 : tag[x.kind][1] }}>{x.text}</Text></View>)}</View> : null}
      {location ? <Text style={{ fontSize: 11, lineHeight: lh(11), fontWeight: "500", color: t.ink2 }}>📍 {location}{locationNote ? <Text style={{ color: t.ink3 }}> {locationNote}</Text> : null}</Text> : null}
      <View>
        <Text style={{ fontSize: 14, lineHeight: lh(14), fontWeight: "800" }}>{total}</Text>
        {payment ? <Text style={{ marginTop: 2, fontSize: 11, lineHeight: lh(11), fontWeight: "500", color: t.ink3 }}>{payment}{paymentRef ? <Text style={{ fontFamily: "monospace", fontSize: 10 }}> {paymentRef}</Text> : null}</Text> : null}
      </View>
      {next ? <View style={{ backgroundColor: t.bg2, borderWidth: 1, borderStyle: "dashed", borderColor: t.border, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 }}><Text style={{ fontSize: 11, lineHeight: lh(11), fontWeight: "600", color: t.ink2 }}>{next}</Text></View> : null}
      {paidLine ? <View style={{ backgroundColor: dark ? t.greenL : "#F0FDF4", borderWidth: 1, borderColor: dark ? t.greenBg : "#86EFAC", borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 }}><Text style={{ fontSize: 11, lineHeight: 18, fontWeight: "600", color: dark ? "#4ADE80" : "#15803D" }}>{paidLine}</Text></View> : null}
      {extra}
      {actions.length ? <View style={[row, { gap: 8, marginTop: 2, flexWrap: "wrap" }]}>{actions.map((a, i) => (
        <Pressable key={i} disabled={a.disabled} onPress={a.onPress} style={{ flex: 1, minWidth: 140, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, opacity: a.disabled ? 0.45 : 1,
          backgroundColor: a.kind === "primary" ? t.brand : a.kind === "green" ? t.green : t.bg, borderWidth: a.kind === "primary" || a.kind === "green" ? 0 : 1, borderColor: a.kind === "danger" ? t.redL : t.border }}>
          <Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "700", color: a.kind === "primary" || a.kind === "green" ? "#FFFFFF" : a.kind === "danger" ? t.red : a.kind === "secondary" ? t.brand : t.ink2 }}>{a.title}</Text>
        </Pressable>
      ))}</View> : null}
    </View>
  );
}

/** .v2-listing-card: grip arrows · 60 px photo · name 15/700 · note 12 · price 14/700 · Live / Pre-order pills · stock chip · Edit / Pause / Delete. */
export function ListingCard({ photo, emoji = "🐟", name, note, price, live, preorder, chips, onUp, onDown, upDisabled, downDisabled, onEdit, onPause, paused, onDelete, onPress }: {
  photo?: string | null; emoji?: string; name: string; note?: string | null; price: string; live?: boolean; preorder?: boolean; chips: string[];
  onUp?: () => void; onDown?: () => void; upDisabled?: boolean; downDisabled?: boolean; onEdit?: () => void; onPause?: () => void; paused?: boolean; onDelete?: () => void; onPress?: () => void;
}) {
  const t = useTheme();
  const dark = useIsDark();
  const act = { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, ...row, justifyContent: "center" as const, gap: 6 };
  return (
    <View style={{ marginHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, overflow: "hidden" }}>
      <View style={[row, { alignItems: "flex-start", paddingTop: 10, paddingBottom: 10, paddingRight: 12, paddingLeft: 4 }]}>
        <View style={{ width: 32 }}>
          <Pressable accessibilityLabel="Move up" disabled={upDisabled} onPress={onUp} style={{ height: 40, alignItems: "center", justifyContent: "center", opacity: upDisabled ? 0.25 : 1 }}><Icon name="chevUp" size={18} color={t.ink} /></Pressable>
          <Pressable accessibilityLabel="Move down" disabled={downDisabled} onPress={onDown} style={{ height: 40, alignItems: "center", justifyContent: "center", opacity: downDisabled ? 0.25 : 1 }}><Icon name="chevDown2" size={18} color={t.ink} /></Pressable>
        </View>
        <Pressable onPress={onPress} style={[row, { flex: 1, gap: 12, marginLeft: 4, alignItems: "flex-start" }]}>
          <View style={{ width: 60, height: 60, borderRadius: 12, backgroundColor: t.bg3, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>{photo ? <Image source={{ uri: photo }} style={{ width: 60, height: 60 }} /> : <Text style={{ fontSize: 26 }}>{emoji}</Text>}</View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, lineHeight: 19.5, fontWeight: "700" }}>{name}</Text>
            {note ? <Text style={{ marginTop: 4, fontSize: 12, lineHeight: 16.2, fontWeight: "500", color: t.ink3 }}>{note}</Text> : null}
            <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 18.2, fontWeight: "700" }}>{price}</Text>
            <View style={[row, { marginTop: 4, gap: 6, flexWrap: "wrap" }]}>
              {live ? <View style={{ backgroundColor: t.greenL, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 8 }}><Text style={{ fontSize: 11, lineHeight: 11, fontWeight: "600", color: t.green }}>Live</Text></View> : null}
              {preorder ? <View style={{ backgroundColor: t.indigoL, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 8 }}><Text style={{ fontSize: 11, lineHeight: 11, fontWeight: "600", color: dark ? t.ink : t.indigo }}>Pre-order</Text></View> : null}
              {chips.map((c) => <View key={c} style={{ backgroundColor: t.bg2, borderWidth: 1, borderColor: t.border, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 8 }}><Text style={{ fontSize: 11, lineHeight: 11, fontWeight: "600", color: t.ink2 }}>{c}</Text></View>)}
            </View>
          </View>
        </Pressable>
      </View>
      <View style={[row, { gap: 8, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: t.bg2, borderTopWidth: 1, borderTopColor: t.border }]}>
        <Pressable onPress={onEdit} style={act}><Icon name="pencil" size={18} color={t.ink2} /><Text style={{ fontSize: 13, fontWeight: "600", color: t.ink2 }}>Edit</Text></Pressable>
        <Pressable onPress={onPause} style={act}><Icon name="pause" size={18} color={t.ink2} /><Text style={{ fontSize: 13, fontWeight: "600", color: t.ink2 }}>{paused ? "Resume" : "Pause"}</Text></Pressable>
        <Pressable onPress={onDelete} style={[act, { backgroundColor: "transparent", borderColor: "rgba(220, 38, 38, 0.4)" }]}><Icon name="trash" size={18} color={t.red} /><Text style={{ fontSize: 13, fontWeight: "600", color: t.red }}>Delete</Text></Pressable>
      </View>
    </View>
  );
}

/** Profile location box: "✅ Location set" 13/600 green, coordinates 11, secondary sm "📍 Use my current location", helper 11. */
export function LocationBox({ set, coords, onUse, busy }: { set: boolean; coords?: string; onUse?: () => void; busy?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ padding: 14, borderRadius: 8, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
      <Text style={{ fontSize: 13, lineHeight: 21, fontWeight: "600", color: set ? t.green : t.orange }}>{set ? "✅ Location set" : "⚠️ Location not set"}</Text>
      {coords ? <Text style={{ marginTop: 4, fontSize: 11, lineHeight: lh(11), color: t.ink3 }}>{coords}</Text> : null}
      <Button title="📍 Use my current location" variant="secondary" size="sm" full loading={busy} onPress={onUse} style={{ marginTop: 10, minHeight: 39 }} />
      <Text style={{ marginTop: 8, fontSize: 11, lineHeight: lh(11), color: t.ink3 }}>Sets your GPS coordinates so buyers can see distance</Text>
    </View>
  );
}

/** Dashboard KPI strip (preview): three translucent tiles on the green hero. */
export function KpiStrip({ items }: { items: { v: string; l: string }[] }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 14 }}>
      {items.map((k) => <View key={k.l} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.16)", borderRadius: 10, padding: 10 }}><Text style={{ fontSize: 20, fontWeight: "800", color: "#FFFFFF" }}>{k.v}</Text><Text style={{ marginTop: 2, fontSize: 11, fontWeight: "600", color: "#FFFFFF", opacity: 0.9 }}>{k.l}</Text></View>)}
    </View>
  );
}

/** Prep list (preview): what to buy and clean for the next slot, summed over its orders. */
export function PrepList({ title, rows }: { title: string; rows: [string, string][] }) {
  const t = useTheme();
  if (!rows.length) return null;
  return (
    <View style={{ marginHorizontal: 24, marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
      <Text style={{ fontSize: 11, fontWeight: "800", letterSpacing: 0.6, color: t.ink3, marginBottom: 6 }}>{title.toUpperCase()}</Text>
      {rows.map(([k, v]) => <View key={k} style={[row, { justifyContent: "space-between", paddingVertical: 2 }]}><Text style={{ fontSize: 13, fontWeight: "600", textTransform: "capitalize" }}>{k}</Text><Text style={{ fontSize: 13, fontWeight: "800" }}>{v}</Text></View>)}
    </View>
  );
}
