/** Account page parts, from pages/me.astro (.v2-me-*). Values from public/design-system/live.html. */
import { Pressable, View } from "react-native";
import { lit, useTheme } from "../theme";
import { grad, lh, row, shadowCss, Text } from "./base";
import { Icon } from "./icons";
import { pal } from "../theme/palette";

/** .v2-me-hero: blue 160° gradient with 3 faint rings, 80 px avatar, name 22/800, phone 12 (75%), Edit profile pill. */
export function ProfileHero({ name, phone, onEdit }: { name: string; phone: string; onEdit?: () => void }) {
  const ring = (l: number, tp: number, s: number) => <View style={{ position: "absolute", left: l, top: tp, width: s, height: s, borderRadius: s / 2, borderWidth: 2, borderColor: lit.meRing }} />;
  return (
    <View style={[{ paddingTop: 32, paddingBottom: 60, paddingHorizontal: 16, alignItems: "center", overflow: "hidden" }, grad(lit.meHero)]}>
      {ring(-60, 111, 220)}{ring(-20, 151, 150)}{ring(190, -40, 180)}
      <View style={[{ width: 80, height: 80, borderRadius: 40, backgroundColor: pal.a255_255_255_02, borderWidth: 2, borderColor: pal.a255_255_255_045, alignItems: "center", justifyContent: "center" }, shadowCss(`0px 4px 16px 0px ${pal.a0_0_0_02}`)]}><Icon name="avatar" size={36} /></View>
      <Text style={{ marginTop: 12, fontSize: 22, lineHeight: lh(22), letterSpacing: -0.4, fontWeight: "800", color: pal.white }}>{name}</Text>
      <Text style={{ marginTop: 4, fontSize: 12, lineHeight: lh(12), color: pal.white, opacity: 0.75 }}>{phone}</Text>
      <Pressable onPress={onEdit} style={[row, { marginTop: 12, gap: 4, backgroundColor: pal.a255_255_255_018, borderWidth: 1, borderColor: pal.a255_255_255_035, borderRadius: 9999, paddingVertical: 7, paddingHorizontal: 18 }]}>
        <Icon name="editProfile" size={11} color={pal.white} /><Text style={{ fontSize: 11, lineHeight: lh(11), fontWeight: "600", color: pal.white }}>Edit profile</Text>
      </Pressable>
    </View>
  );
}

/** .v2-me-quick: white card pulled 36 px up over the hero, 4 tiles (42 px tinted icon tile + 10/600 label). */
export function QuickTiles({ items }: { items: { icon: "qaPin" | "qaOrders" | "qaBell" | "qaPhone"; label: string; onPress?: () => void }[] }) {
  const t = useTheme();
  const tint = { qaPin: lit.qa.pin, qaOrders: lit.qa.orders, qaBell: lit.qa.bell, qaPhone: lit.qa.phone };
  return (
    <View style={[{ marginTop: -36, marginHorizontal: 16, flexDirection: "row", backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, borderRadius: 16, paddingTop: 14, paddingBottom: 12, paddingHorizontal: 6 }, shadowCss(`0px 4px 24px 0px ${pal.a0_0_0_01}`)]}>
      {items.map((it) => (
        <Pressable key={it.label} onPress={it.onPress} style={{ flex: 1, alignItems: "center", paddingVertical: 4, paddingHorizontal: 2 }}>
          <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: tint[it.icon][0], alignItems: "center", justifyContent: "center" }}><Icon name={it.icon} size={20} /></View>
          <Text style={{ marginTop: 5, fontSize: 10, lineHeight: lh(10), fontWeight: "600", color: t.ink2 }}>{it.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** #v2-me-email-banner: brand-l card, mail icon, "Add email for order updates" 12/600, blue "Add →" button. */
export function EmailPrompt({ onAdd }: { onAdd?: () => void }) {
  const t = useTheme();
  return (
    <View style={[row, { marginHorizontal: 16, gap: 8, backgroundColor: t.brandL, borderWidth: 1, borderColor: lit.emailBorder, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 }]}>
      <Icon name="mail" size={16} />
      <Text style={{ fontSize: 12, lineHeight: lh(12), fontWeight: "600", color: lit.emailInk }}>Add email for order updates</Text>
      <Pressable onPress={onAdd} style={{ backgroundColor: lit.emailBtn, borderRadius: 6, paddingVertical: 5, paddingHorizontal: 12 }}><Text style={{ fontSize: 11, lineHeight: lh(11), fontWeight: "600", color: pal.white }}>Add →</Text></Pressable>
    </View>
  );
}

/** .v2-me-section-head: 13/700 title followed by a hairline. */
export function MeSectionHead({ title }: { title: string }) {
  const t = useTheme();
  return (
    <View style={[row, { gap: 10, paddingTop: 20, paddingBottom: 8, paddingHorizontal: 16 }]}>
      <Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "700" }}>{title}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
    </View>
  );
}

/** .v2-me-addr-card: label 13/700 + DEFAULT 10/600 green caps, text 12 ink-2, trash icon. */
export function SavedAddress({ label, text, isDefault, onDelete, onPress }: { label: string; text: string; isDefault?: boolean; onDelete?: () => void; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={[row, { marginHorizontal: 16, gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "700" }}>{label}  {isDefault ? <Text style={{ fontSize: 10, fontWeight: "600", textTransform: "uppercase", color: t.green }}>Default</Text> : null}</Text>
        <Text style={{ marginTop: 2, fontSize: 12, lineHeight: 16.8, color: t.ink2 }}>{text}</Text>
      </View>
      <Pressable accessibilityLabel="Delete address" onPress={onDelete} hitSlop={8} style={{ padding: 4 }}><Icon name="trash" size={16} color={t.red} /></Pressable>
    </Pressable>
  );
}

/** Order history row: seller 13/700 + status pill, "Today · 0.25kg prawns" 11, rule, total 13/800 + "View →". */
export function OrderHistoryRow({ seller, line, status, statusTone, total, onPress }: { seller: string; line: string; status: string; statusTone: "red" | "green" | "amber" | "brand"; total: string; onPress?: () => void }) {
  const t = useTheme();
  const pill = { red: lit.cancelPill, green: [t.greenBg, t.green], amber: [t.amberL, t.amber], brand: [t.brandL, t.brand] }[statusTone];
  return (
    <Pressable onPress={onPress} style={{ marginHorizontal: 16, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
      <View style={[row, { justifyContent: "space-between", alignItems: "flex-start" }]}>
        <View>
          <Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "700" }}>{seller}</Text>
          <Text style={{ marginTop: 1, fontSize: 11, lineHeight: lh(11), color: t.ink3, textTransform: "none" }}>{line}</Text>
        </View>
        <View style={{ backgroundColor: pill[0], borderRadius: 20, paddingVertical: 3, paddingHorizontal: 10 }}><Text style={{ fontSize: 10, lineHeight: lh(10), fontWeight: "600", color: pill[1] }}>{status}</Text></View>
      </View>
      <View style={[row, { justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.border }]}>
        <Text style={{ fontSize: 13, lineHeight: lh(13), fontWeight: "800" }}>{total}</Text>
        <Text style={{ fontSize: 11, lineHeight: lh(11), fontWeight: "600", color: t.ink3 }}>View →</Text>
      </View>
    </Pressable>
  );
}
