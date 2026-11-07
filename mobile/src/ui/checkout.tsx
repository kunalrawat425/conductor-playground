/** Checkout sheet parts, from organisms/CheckoutSheet.astro (.v2-co-*). Values from public/design-system/live.html. */
import { Image, Pressable, ScrollView, TextInput, View } from "react-native";
import { lit, useIsDark, useTheme } from "../theme";
import { grad, lh, row, shadowCss, Text } from "./base";
import { Icon } from "./icons";
import { Diya } from "./chrome";
import { pal } from "../theme/palette";

/** .v2-co-card: 16 radius, 1 px border, 14 pad, 12 px inset from the sheet edges. */
export function CoCard({ children, title, style }: { children: React.ReactNode; title?: string; style?: any }) {
  const t = useTheme();
  return (
    <View style={[{ marginHorizontal: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg }, style]}>
      {title ? <Text style={{ marginBottom: 10, fontSize: 17, lineHeight: lh(17), fontWeight: "800" }}>{title}</Text> : null}
      {children}
    </View>
  );
}

export type CartLineItem = { photo?: string | null; name: string; sub: string; qty: number; price: string; was?: string | null };
/** Shipment row (40 px clock tile, "Pre-order · Sun 15 Nov" 17/800, "Shipment of n item from …", Pick time) + ITEMS / Clear + lines. */
export function CheckoutCart({ when, shipment, items, onPickTime, onClear, onQty }: { when: string; shipment: string; items: CartLineItem[]; onPickTime?: () => void; onClear?: () => void; onQty?: (i: number, d: 1 | -1) => void }) {
  const t = useTheme();
  return (
    <CoCard>
      <View style={[row, { gap: 12, minHeight: 61 }]}>
        <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: t.brandL, alignItems: "center", justifyContent: "center" }}><Icon name="clock" size={20} color={t.brand} /></View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, lineHeight: 21.25, fontWeight: "800" }}>{when}</Text>
          <Text style={{ marginTop: 3, fontSize: 13, lineHeight: 18, color: t.ink3 }}>{shipment}</Text>
        </View>
        <Pressable onPress={onPickTime} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }}><Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "700", color: t.link }}>Pick time</Text></Pressable>
      </View>
      <View style={[row, { marginTop: 4, justifyContent: "space-between", borderTopWidth: 1, borderTopColor: t.border, minHeight: 45 }]}>
        <Text style={{ fontSize: 11, lineHeight: lh(11), letterSpacing: 0.66, fontWeight: "700", textTransform: "uppercase", color: t.ink3 }}>Items</Text>
        <Pressable onPress={onClear} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }}><Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "600", color: t.ink3 }}>Clear</Text></Pressable>
      </View>
      {items.map((it, i) => (
        <View key={i} style={[row, { gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.bg3 }]}>
          <View style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: t.brandL, overflow: "hidden" }}>{it.photo ? <Image source={{ uri: it.photo }} style={{ width: 56, height: 56 }} /> : null}</View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={2} style={{ fontSize: 14, lineHeight: 18.2, fontWeight: "600" }}>{it.name}</Text>
            <Text style={{ marginTop: 4, fontSize: 12, lineHeight: lh(12), color: t.ink3 }}>{it.sub}</Text>
          </View>
          <View style={{ alignItems: "flex-end", width: 82 }}>
            <View style={[row, { backgroundColor: t.brand, borderRadius: 8, height: 32 }]}>
              <Pressable accessibilityLabel="Remove one" onPress={() => onQty?.(i, -1)} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 16, fontWeight: "800", color: pal.white }}>−</Text></Pressable>
              <Text style={{ width: 18, textAlign: "center", fontSize: 13, fontWeight: "800", color: pal.white }}>{it.qty}</Text>
              <Pressable accessibilityLabel="Add one" onPress={() => onQty?.(i, 1)} style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 16, fontWeight: "800", color: pal.white }}>+</Text></Pressable>
            </View>
            <Text style={{ marginTop: 6, fontSize: 14, lineHeight: lh(14), fontWeight: "700" }}>
              {it.was ? <Text style={{ fontSize: 12, fontWeight: "500", color: t.ink4, textDecorationLine: "line-through" }}>{it.was} </Text> : null}{it.price}
            </Text>
          </View>
        </View>
      ))}
    </CoCard>
  );
}

/** .v2-co-gift (Diwali only): cream→peach card, 🪔, "Happy Diwali!" 17/800, line 13, outlined Open button. */
export function DiwaliGiftCard({ onOpen }: { onOpen?: () => void }) {
  const t = useTheme();
  return (
    <View style={[row, { marginHorizontal: 12, gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: lit.giftBorder }, grad(lit.giftGrad)]}>
      <Diya />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 17, lineHeight: lh(17), fontWeight: "800", color: lit.giftTitle }}>Happy Diwali!</Text>
        <Text style={{ marginTop: 3, fontSize: 13, lineHeight: 18, fontWeight: "500", color: lit.giftText }}>Send a Diwali greeting to your family & friends</Text>
      </View>
      <Pressable onPress={onOpen} style={{ height: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: t.orange, backgroundColor: pal.white }}><Text style={{ fontSize: 14, fontWeight: "800", color: t.orange }}>Open</Text></Pressable>
    </View>
  );
}

export type Suggest = { photo?: string | null; price: string; was?: string | null; name: string; size: string };
/** "You might also like": 118 px cards (116 px photo, ADD 64×36 outlined), price 15/800, name 12/600, size 11. */
export function SuggestRail({ items, onAdd }: { items: Suggest[]; onAdd?: (i: number) => void }) {
  const t = useTheme();
  return (
    <CoCard title="You might also like">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {items.map((s, i) => (
          <View key={i} style={{ width: 118, borderRadius: 14, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, overflow: "hidden" }}>
            <View style={{ width: 116, height: 116, backgroundColor: t.brandL }}>
              {s.photo ? <Image source={{ uri: s.photo }} style={{ width: 116, height: 116 }} /> : null}
              <Pressable onPress={() => onAdd?.(i)} style={[{ position: "absolute", left: 26, bottom: 6, width: 64, height: 36, borderRadius: 9, borderWidth: 1, borderColor: t.brand, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }, shadowCss(`0px 2px 6px 0px ${pal.a0_0_0_012}`)]}><Text style={{ fontSize: 13, fontWeight: "800", color: t.brand }}>ADD</Text></Pressable>
            </View>
            <View style={{ paddingTop: 8, paddingBottom: 10, paddingHorizontal: 10 }}>
              <Text style={{ fontSize: 15, lineHeight: lh(15), fontWeight: "800" }}>{s.price}{s.was ? <Text style={{ fontSize: 11, fontWeight: "500", color: t.ink4, textDecorationLine: "line-through" }}> {s.was}</Text> : null}</Text>
              <Text numberOfLines={2} style={{ marginTop: 4, fontSize: 12, lineHeight: 15, fontWeight: "600" }}>{s.name}</Text>
              <Text style={{ marginTop: 2, fontSize: 11, lineHeight: lh(11), color: t.ink3 }}>{s.size}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </CoCard>
  );
}

/** "How should it be prepared? (optional)": 3 pill options + a note box. */
export function PrepPrefs({ options, value, onChange, note, onNote }: { options: string[]; value?: string; onChange?: (v: string) => void; note: string; onNote?: (v: string) => void }) {
  const t = useTheme();
  return (
    <View style={{ marginHorizontal: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
      <Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "700" }}>How should it be prepared? <Text style={{ fontSize: 11, fontWeight: "400", color: t.ink3 }}>(optional)</Text></Text>
      <View style={{ flexDirection: "row", gap: 8, paddingTop: 8 }}>
        {options.map((o) => <Pressable key={o} onPress={() => onChange?.(o)} style={{ flex: 1, height: 44, borderRadius: 999, borderWidth: 1, borderColor: value === o ? t.brand : t.border, backgroundColor: value === o ? t.brandL : "transparent", alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 12, fontWeight: "600" }}>{o}</Text></Pressable>)}
      </View>
      <TextInput value={note} onChangeText={onNote} placeholder="Special request, e.g. medium pieces, no head" placeholderTextColor={t.ink4} multiline
        style={{ marginTop: 10, minHeight: 62, borderWidth: 1, borderColor: t.border, borderRadius: 8, padding: 10, fontSize: 14, color: t.ink, fontFamily: "Inter_400Regular", textAlignVertical: "top" }} />
    </View>
  );
}

export type BillRow = { k: string; v: string; was?: string | null; saved?: string | null; hint?: string | null };
/** Bill details: rows 14/500 (Saved pill), orange hint, dashed rule, "To pay" 16/800, savings bar (brand-l, 15/900). */
export function BillDetails({ rows, toPay, savings }: { rows: BillRow[]; toPay: string; savings?: string | null }) {
  const t = useTheme();
  const dark = useIsDark();
  return (
    <CoCard title="Bill details">
      {rows.map((r, i) => (
        <View key={i}>
          <View style={[row, { justifyContent: "space-between", paddingVertical: 7 }]}>
            <View style={[row, { gap: 6 }]}>
              <Text style={{ fontSize: 14, lineHeight: 23, fontWeight: "500", color: t.ink2 }}>{r.k}</Text>
              {r.saved ? <View style={{ backgroundColor: t.brandL, borderRadius: 5, paddingVertical: 2, paddingHorizontal: 7 }}><Text style={{ fontSize: 11, lineHeight: lh(11), fontWeight: "700", color: t.link }}>{r.saved}</Text></View> : null}
            </View>
            <Text style={{ fontSize: 14, lineHeight: lh(14), fontWeight: "700" }}>{r.was ? <Text style={{ fontSize: 12, fontWeight: "500", color: t.ink4, textDecorationLine: "line-through" }}>{r.was} </Text> : null}{r.v}</Text>
          </View>
          {r.hint ? <Text style={{ marginLeft: 26, marginTop: -4, marginBottom: 4, fontSize: 12, lineHeight: lh(12), fontWeight: "500", color: t.orange }}>{r.hint}</Text> : null}
        </View>
      ))}
      <View style={[row, { justifyContent: "space-between", paddingVertical: 7, borderTopWidth: 1, borderStyle: "dashed", borderTopColor: dark ? t.ink4 : t.ink4 }]}>
        <Text style={{ fontSize: 16, lineHeight: lh(16), fontWeight: "800" }}>To pay</Text>
        <Text style={{ fontSize: 16, lineHeight: lh(16), fontWeight: "800" }}>{toPay}</Text>
      </View>
      {savings ? <View style={[row, { marginTop: 10, justifyContent: "space-between", backgroundColor: t.brandL, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 }]}><Text style={{ fontSize: 15, lineHeight: lh(15), fontWeight: "900", color: t.link }}>Your total savings</Text><Text style={{ fontSize: 15, lineHeight: lh(15), fontWeight: "900", color: t.link }}>{savings}</Text></View> : null}
    </CoCard>
  );
}

/** .v2-co-foot: delivering-to row (🏠, 15/700 + address 13, Change) + pay bar (52 px brand button: total/TOTAL left, CTA right). */
export function CheckoutFoot({ to, address, total, cta, onChange, onPay, disabled, safeBottom = 0 }: { to: string; address: string; total: string; cta: string; onChange?: () => void; onPay?: () => void; disabled?: boolean; safeBottom?: number }) {
  const t = useTheme();
  return (
    <View style={[{ backgroundColor: t.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16 }, shadowCss(`0px -4px 16px 0px ${pal.a0_0_0_008}`)]}>
      <View style={[row, { gap: 10, paddingVertical: 4, paddingLeft: 16, paddingRight: 12, minHeight: 53, borderBottomWidth: 1, borderBottomColor: t.border }]}>
        <Icon name="homeO" size={22} color={t.ink} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 15, lineHeight: lh(15), fontWeight: "700" }}>{to}</Text>
          <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: lh(13), color: t.ink3 }}>{address}</Text>
        </View>
        <Pressable onPress={onChange} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }}><Text style={{ fontSize: 13, fontWeight: "700", color: t.link }}>Change</Text></Pressable>
      </View>
      <View style={{ padding: 14, paddingBottom: 14 + safeBottom }}>
        <Pressable disabled={disabled} onPress={onPay} style={[row, { justifyContent: "space-between", minHeight: 52, borderRadius: 12, backgroundColor: t.brand, paddingVertical: 8, paddingHorizontal: 14, opacity: disabled ? 0.5 : 1 }]}>
          <View><Text style={{ fontSize: 15, lineHeight: lh(15), fontWeight: "800", color: pal.white }}>{total}</Text><Text style={{ fontSize: 10, lineHeight: lh(10), fontWeight: "600", color: pal.white, opacity: 0.9 }}>TOTAL</Text></View>
          <Text style={{ fontSize: 15, lineHeight: lh(15), fontWeight: "800", color: pal.white }}>{cta}</Text>
        </Pressable>
      </View>
    </View>
  );
}
