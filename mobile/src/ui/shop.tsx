/**
 * Home + seller page components, from pages/shop.astro, pages/seller/[id].astro, molecules/PreorderBanner.astro,
 * CategoryStrip.astro, organisms/SellerHero.astro and atoms/Badge.astro. Values from public/design-system/live.html.
 */
import { Image, Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { festive as F, lit, useFestive, useIsDark, useTheme } from "../theme";
import { grad, lh, row, shadowCss, Text } from "./base";
import { DiwaliLights } from "./chrome";
import { Icon, type IconName } from "./icons";
import { pal } from "../theme/palette";

type Tone = "ink" | "green" | "indigo" | "red" | "orange" | "brand";
/** .v2-badge: rating (green fill, 5 radius), tag (tinted pill with a 1 px border), offer (brand fill), status. */
export function Badge({ text, variant = "tag", color = "ink", bold, style }: { text: string; variant?: "rating" | "tag" | "offer" | "status"; color?: Tone; bold?: boolean; style?: ViewStyle }) {
  const t = useTheme();
  if (variant === "rating") return <View style={[{ alignSelf: "flex-start", backgroundColor: t.green, borderRadius: 5, paddingVertical: 3, paddingHorizontal: 7 }, style]}><Text style={{ fontSize: 11, lineHeight: 11, fontWeight: "700", color: pal.white }}>{text}</Text></View>;
  if (variant === "offer") return <View style={[{ alignSelf: "flex-start", backgroundColor: t.brand, borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8 }, style]}><Text style={{ fontSize: 11, lineHeight: 11, fontWeight: "700", color: pal.white }}>{text}</Text></View>;
  if (variant === "status") return <View style={[{ alignSelf: "flex-start", borderRadius: 5, paddingVertical: 3, paddingHorizontal: 7 }, style]}><Text style={{ fontSize: 11, lineHeight: 11, fontWeight: "700" }}>{text}</Text></View>;
  const c: Record<Tone, [string, string, string]> = {
    ink: [t.bg3, t.border, t.ink2], green: [t.greenL, t.green, t.green], indigo: [t.indigoL, t.indigo, t.indigo],
    red: [t.redL, t.red, t.red], orange: [t.orangeL, t.orange, t.orange], brand: [t.brandL, t.brand, t.brand],
  };
  const [bg, border, fg] = c[color];
  return (
    <View style={[{ alignSelf: "flex-start", backgroundColor: bg, borderWidth: 1, borderColor: border, borderRadius: 20, paddingVertical: 4, paddingHorizontal: 10 }, style]}>
      <Text style={{ fontSize: 11, lineHeight: 11, fontWeight: bold ? "800" : "600", color: fg }}>{text}</Text>
    </View>
  );
}

/** .v2-pb-inline: indigo card, 32 px emoji, title 14/700 indigo-d, line 11 indigo, pill button. Modes: preorder / notify / blocked. */
export function PreorderBanner({ icon, title, text, cta, onPress }: { icon: IconName; title: string; text: string; cta: string; onPress?: () => void }) {
  const t = useTheme();
  const dark = useIsDark();
  return (
    <Pressable onPress={onPress} style={[{ ...row, gap: 12, marginHorizontal: 16, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: dark ? t.indigoL : lit.pbBorder, backgroundColor: t.indigoL }, dark ? null : grad(lit.pbGrad)]}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={22} color={t.indigo} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, lineHeight: lh(14), fontWeight: "700", color: dark ? pal.hA5B4FC : t.indigoD }}>{title}</Text>
        <Text style={{ marginTop: 2, fontSize: 11, lineHeight: 14, color: dark ? pal.hC7D2FE : t.indigo }}>{text}</Text>
      </View>
      <View style={{ backgroundColor: t.indigo, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 }}><Text style={{ fontSize: 11, lineHeight: lh(11), fontWeight: "700", color: pal.white }}>{cta}</Text></View>
    </Pressable>
  );
}

export type Category = { id: string; name: string; photo: any };
/** .v2-cat-strip: 64 px round plate photos (2 px border; active: brand border + 3 px ring), 10 px labels. */
export function CategoryStrip({ items, active, onPick }: { items: Category[]; active: string; onPick: (id: string) => void }) {
  const t = useTheme();
  const dark = useIsDark();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingTop: 10, paddingBottom: 8, paddingHorizontal: 16, gap: 8 }}>
      {items.map((c) => {
        const on = c.id === active;
        return (
          <Pressable key={c.id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onPick(c.id)} style={{ width: 72, alignItems: "center" }}>
            <View style={[{ width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: on ? t.brand : lit.catIdleBorder(dark), backgroundColor: t.bg, overflow: "visible", alignItems: "center", justifyContent: "center" }, shadowCss(on ? `0px 0px 0px 3px ${lit.catRing(dark)}, 0px 2px 8px 0px ${pal.a0_0_0_012}` : `0px 1px 4px 0px ${pal.a0_0_0_04_008}`)]}>
              <Image source={c.photo} style={{ width: 60, height: 60, borderRadius: 30 }} />
            </View>
            <Text numberOfLines={1} style={{ marginTop: 6, fontSize: 10, lineHeight: 12, letterSpacing: 0.1, fontWeight: on ? "700" : "500", color: on ? t.brand : t.ink3 }}>{c.name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export type Chip = { key: string; label: string } | "sep";
/** .v2-filter-chips: pills 7/14, 600 12, 1 px border; active brand. "sep" = 1×20 divider. */
export function FilterChips({ chips, isActive, onPress }: { chips: Chip[]; isActive: (key: string) => boolean; onPress: (key: string) => void }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ ...row, paddingTop: 6, paddingBottom: 8, paddingHorizontal: 16, gap: 6 }}>
      {chips.map((c, i) => c === "sep" ? <View key={`s${i}`} style={{ width: 1, height: 20, backgroundColor: t.border, marginHorizontal: 2 }} /> : (
        <Pressable key={c.key} accessibilityRole="button" accessibilityState={{ selected: isActive(c.key) }} onPress={() => onPress(c.key)} style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 9999, borderWidth: 1, borderColor: isActive(c.key) ? t.brand : t.border, backgroundColor: isActive(c.key) ? t.brand : t.bg }}>
          <Text style={{ fontSize: 12, lineHeight: 15, fontWeight: "600", color: isActive(c.key) ? pal.white : t.ink2 }}>{c.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** .v2-section-head: 18/800 title + brand count pill. */
export function SectionHead({ title, count }: { title: string; count?: string | number }) {
  const t = useTheme();
  return (
    <View style={[row, { justifyContent: "space-between", paddingTop: 20, paddingBottom: 10, paddingHorizontal: 16 }]}>
      <Text style={{ fontSize: 18, lineHeight: lh(18), fontWeight: "800" }}>{title}</Text>
      {count != null ? <View style={{ backgroundColor: t.brand, borderRadius: 9999, paddingVertical: 3, paddingHorizontal: 10 }}><Text style={{ fontSize: 12, lineHeight: 15, fontWeight: "700", color: pal.white }}>{count}</Text></View> : null}
    </View>
  );
}

export type MenuChip = { photo?: string | null; name: string; price: string };
/**
 * .v2-seller-card (shop.astro renderFiltered): 160 px cover (store photo + dark overlay, or hue gradient + faint Relifish
 * logo), rating badge, name + ONE status badge, area · km, menu chips, delivery strip. Diwali: gold border + glow.
 */
export function SellerCard({ name, sub, status, statusColor, rating, cover, hue = "sky", chips, more, delivery, pickupOnly, onPress }: {
  name: string; sub: string; status: string; statusColor: "green" | "indigo"; rating?: string | null; cover?: string | null; hue?: keyof typeof lit.hue;
  chips: MenuChip[]; more?: number; delivery?: string | null; pickupOnly?: boolean; onPress?: () => void;
}) {
  const t = useTheme();
  const dark = useIsDark();
  const on = useFestive();
  return (
    <Pressable onPress={onPress} style={[{ marginHorizontal: 16, backgroundColor: t.bg, borderRadius: 16, borderWidth: 1, borderColor: on ? F.cardBorder : pal.a0_0_0_006, overflow: "hidden" },
      shadowCss(on ? `0px 0px 0px 1px ${pal.a212_162_76_035}, 0px 2px 12px 0px ${pal.a212_162_76_028}, 0px 1px 3px 0px ${pal.a0_0_0_006}` : `0px 2px 12px 0px ${pal.a0_0_0_01}, 0px 1px 3px 0px ${pal.a0_0_0_006}`)]}>
      <View style={[{ height: 160 }, grad(lit.hue[hue])]}>
        {cover ? <><Image source={{ uri: cover }} style={{ position: "absolute", inset: 0 } as any} resizeMode="cover" /><View style={[{ position: "absolute", inset: 0 } as any, grad(lit.scOverlay)]} /></>
          : <Image source={require("../../assets/logo-horizontal.png")} style={{ position: "absolute", right: 14, bottom: 13, width: 50, height: 28, opacity: 0.18 }} resizeMode="contain" />}
        {rating ? <View style={{ position: "absolute", top: 10, left: 10 }}><Badge variant="rating" text={rating} /></View> : null}
      </View>
      <View style={{ paddingTop: 12, paddingBottom: 10, paddingHorizontal: 14 }}>
        <View style={[row, { gap: 6, justifyContent: "space-between" }]}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, lineHeight: 18.2, fontWeight: "700" }}>{name}</Text>
          <Badge text={status} color={statusColor} bold />
        </View>
        <Text style={{ marginTop: 2, fontSize: 11, lineHeight: 15.4, color: t.ink3 }}>{sub}</Text>
        {pickupOnly ? <Badge text="Pickup only" style={{ marginTop: 5 }} /> : null}
      </View>
      {chips.length ? (
        <View style={{ flexDirection: "row", gap: 6, backgroundColor: t.bg, borderTopWidth: 1, borderTopColor: t.border, paddingTop: 8, paddingBottom: 10, paddingHorizontal: 12 }}>
          {chips.map((c, i) => (
            <View key={i} style={[row, { flex: 1, gap: 7, backgroundColor: t.bg2, borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 9 }]}>
              {c.photo ? <Image source={{ uri: c.photo }} style={{ width: 40, height: 40, borderRadius: 8 }} /> : null}
              <View style={{ flex: 1 }}>
                <Text numberOfLines={2} style={{ fontSize: 11, lineHeight: 14.85, fontWeight: "600", textTransform: "capitalize" }}>{c.name}</Text>
                <Text style={{ marginTop: 2, fontSize: 11, lineHeight: lh(11), fontWeight: "700", color: t.green }}>{c.price}</Text>
              </View>
            </View>
          ))}
          {more ? <View style={{ flex: 1, borderWidth: 1, borderStyle: "dashed", borderColor: t.border, borderRadius: 10, alignItems: "center", justifyContent: "center", minHeight: 62 }}><Text style={{ fontSize: 11, fontWeight: "700", color: t.ink3 }}>+{more} more</Text></View> : null}
        </View>
      ) : null}
      {delivery ? <View style={{ backgroundColor: t.greenL, borderTopWidth: 1, borderTopColor: lit.scDeliveryBorder(dark), paddingVertical: 8, paddingHorizontal: 14 }}><Text style={{ fontSize: 11, lineHeight: 18, fontWeight: "600", color: t.green }}>{delivery}</Text></View> : null}
    </Pressable>
  );
}

/**
 * View-cart bubble. Seller page (.v2-cart-float): optional status chip above + 250×56 brand pill.
 * Home (.hc-pill): min 240 wide, 54 high, up to 2 thumbnails, "View cart(s)", "n items · ₹ · n shops".
 */
export function CartBubble({ title = "View cart", line, thumbs, chip, chipColor, onPress, home }: { title?: string; line: string; thumbs: (string | null)[]; chip?: string | null; chipColor?: string; onPress?: () => void; home?: boolean }) {
  const t = useTheme();
  return (
    <View pointerEvents="box-none" style={{ alignItems: "center", gap: 8 }}>
      {chip ? <View style={[{ backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12, maxWidth: 358 }, shadowCss(`0px 2px 8px 0px ${pal.a0_0_0_008}`)]}><Text numberOfLines={1} style={{ fontSize: 12, lineHeight: lh(12), fontWeight: "600", color: chipColor ?? t.ink2 }}>{chip}</Text></View> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${title}: ${line}`} onPress={onPress} style={[row, { gap: 10, width: home ? undefined : 250, minWidth: home ? 240 : undefined, minHeight: home ? 54 : 56, borderRadius: 999, backgroundColor: lit.cartBlue, paddingVertical: home ? 7 : 8, paddingLeft: home ? 7 : 8, paddingRight: 14 }, shadowCss(lit.cartShadow)]}>
        <View style={{ flexDirection: "row" }}>
          {thumbs.slice(0, 2).map((u, i) => (
            <View key={i} style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: pal.white, backgroundColor: pal.white, overflow: "hidden", marginLeft: i ? -14 : 0, alignItems: "center", justifyContent: "center" }}>
              {u ? <Image source={{ uri: u }} style={{ width: 34, height: 34 }} /> : null}
            </View>
          ))}
        </View>
        <View style={{ flex: home ? undefined : 1, marginRight: home ? 10 : 0 }}>
          <Text style={{ fontSize: 16, lineHeight: 20, fontWeight: "800", color: pal.white }}>{title}</Text>
          <Text style={{ marginTop: 1, fontSize: 12, lineHeight: 15, fontWeight: "500", color: pal.white, opacity: 0.9 }}>{line}</Text>
        </View>
        <Text style={{ fontSize: home ? 22 : 24, lineHeight: 24, color: pal.white }}>›</Text>
      </Pressable>
    </View>
  );
}

/** organisms/SellerHero.astro: 260 px cover (+ lights in Diwali, bottom shade), 60 px avatar, name 20/800, area, rating, tags, stats box. */
export function SellerHero({ cover, logo, name, area, rating, tags, stats, still }: {
  cover?: string | null; logo?: string | null; name: string; area: string; rating?: string | null; tags: string[];
  stats: { v: string; l: string; live?: boolean }[]; still?: boolean;
}) {
  const t = useTheme();
  const on = useFestive();
  return (
    <View style={{ backgroundColor: t.bg2, paddingBottom: 16 }}>
      <View style={{ height: 260, backgroundColor: t.bg3 }}>
        {cover ? <Image source={{ uri: cover }} style={{ width: "100%", height: 260 }} resizeMode="cover" /> : null}
        <View style={[{ position: "absolute", inset: 0 } as any, grad(lit.heroShade)]} />
        {on ? <DiwaliLights still={still} /> : null}
      </View>
      <View style={{ paddingHorizontal: 16 }}>
        <View style={[row, { marginTop: 14, gap: 12, alignItems: "flex-start" }]}>
          <View style={[{ width: 60, height: 60, borderRadius: 14, overflow: "hidden" }, grad(lit.avatarGrad), shadowCss(`0px 1px 3px 0px ${pal.a0_0_0_01}, 0px 1px 2px 0px ${pal.a0_0_0_006}`)]}>
            {logo ? <Image source={{ uri: logo }} style={{ width: 60, height: 60 }} /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, lineHeight: 24, fontWeight: "800" }}>{name}</Text>
            <Text style={{ marginTop: 3, fontSize: 12, lineHeight: 16.8, color: t.ink3 }}>{area}</Text>
          </View>
          {rating ? <Badge variant="rating" text={rating} /> : null}
        </View>
        <View style={[row, { marginTop: 12, gap: 6, flexWrap: "wrap" }]}>{tags.map((x) => <Badge key={x} text={x} />)}</View>
        <View style={{ marginTop: 16, flexDirection: "row", backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, borderRadius: 12 }}>
          {stats.map((s, i) => (
            <View key={i} style={{ flex: 1, alignItems: "center", paddingVertical: 12, paddingHorizontal: 4, borderLeftWidth: i ? 1 : 0, borderLeftColor: t.border }}>
              <Text style={{ fontSize: 15, lineHeight: lh(15), fontWeight: "800", color: s.live ? t.green : t.ink }}>{s.live ? "● " : ""}{s.v}</Text>
              <Text style={{ marginTop: 2, fontSize: 12, lineHeight: lh(12), fontWeight: "500", color: t.ink4 }}>{s.l}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/** Seller timing pill (pre-order schedule): purple tint, 1 px #C4B5FD border, 11/500 (1.35), wraps. */
export function TimingStrip({ text, sameDay }: { text: string; /** the same-day line uses the plain tag colours */ sameDay?: boolean }) {
  const t = useTheme();
  const dark = useIsDark();
  if (sameDay) return <View style={{ alignSelf: "flex-start", backgroundColor: t.bg3, borderWidth: 1, borderColor: t.border, borderRadius: 20, paddingVertical: 4, paddingHorizontal: 10 }}><Text style={{ fontSize: 11, lineHeight: 14.85, fontWeight: "500", color: t.ink2 }}>{text}</Text></View>;
  return <View style={{ alignSelf: "flex-start", backgroundColor: t.purpleL, borderWidth: 1, borderColor: dark ? t.purpleL : lit.itemTierBorder, borderRadius: 20, paddingVertical: 4, paddingHorizontal: 10 }}><Text style={{ fontSize: 11, lineHeight: 14.85, fontWeight: "500", color: dark ? pal.hC4B5FD : t.purple }}>{text}</Text></View>;
}
/** Schedule strip under the seller hero: bg-2, 8/16 padding, 1 px bottom rule, the same-day and pre-order lines. */
export function ScheduleStrip({ sameDay, preorder }: { sameDay?: string | null; preorder?: string | null }) {
  const t = useTheme();
  if (!sameDay && !preorder) return null;
  return <View style={{ paddingVertical: 8, paddingHorizontal: 16, backgroundColor: t.bg2, borderBottomWidth: 1, borderBottomColor: t.border, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{sameDay ? <TimingStrip sameDay text={`${sameDay}`} /> : null}{preorder ? <TimingStrip text={`${preorder}`} /> : null}</View>;
}

/** Menu header row: "Pre-order Menu" 17/800 · "n items" 12/600 ink-3. */
export function MenuHeader({ title, count }: { title: string; count: number }) {
  const t = useTheme();
  return (
    <View style={[row, { justifyContent: "space-between", paddingTop: 16, paddingBottom: 8, paddingHorizontal: 16 }]}>
      <Text style={{ fontSize: 17, lineHeight: lh(17), fontWeight: "800" }}>{title}</Text>
      <Text style={{ fontSize: 12, lineHeight: lh(12), fontWeight: "600", color: t.ink3 }}>{count} items</Text>
    </View>
  );
}

export type Tier = { label: string; price: string; was?: string | null; off?: string | null; best?: boolean; count: number; unit?: string };
/** .v2-item-tier: 1.5 px border, 12 radius; in cart: brand border + brand-l fill and a "− n pack +" counter; else a 40×40 "+". */
export function TierRow({ tier, onAdd, onRemove, disabled, first }: { tier: Tier; onAdd: () => void; onRemove: () => void; disabled?: boolean; /** first row in the card (CSS margin collapsing) */ first?: boolean }) {
  const t = useTheme();
  const inCart = tier.count > 0;
  return (
    <View style={{ ...row, gap: 8, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 8, marginTop: tier.best ? (first ? 10 : 6) : 0, borderWidth: 1.5, borderRadius: 12, borderColor: inCart ? t.brand : t.border, backgroundColor: inCart ? t.brandL : t.bg }}>
      <View style={{ flex: 1, paddingRight: 0 }}>
        <Pressable onPress={onAdd} disabled={disabled}><Text style={{ fontSize: 13, lineHeight: 18.85, fontWeight: "700" }}>{tier.label}</Text></Pressable>
        <View style={[row, { marginTop: 5 }]}>
          <Text style={{ fontSize: 16, lineHeight: lh(16), fontWeight: "800" }}>{tier.price}</Text>
          {tier.was ? <Text style={{ marginLeft: 6, fontSize: 12, lineHeight: lh(12), fontWeight: "500", color: t.ink4, textDecorationLine: "line-through" }}>{tier.was}</Text> : null}
          {tier.off ? <View style={{ marginLeft: 6, backgroundColor: t.brand, borderRadius: 5, paddingVertical: 2, paddingHorizontal: 6 }}><Text style={{ fontSize: 11, lineHeight: 14.3, letterSpacing: 0.22, fontWeight: "800", color: pal.white }}>{tier.off}</Text></View> : null}
        </View>
      </View>
      {disabled ? null : inCart ? (
        <View style={[row, { backgroundColor: t.brand, borderRadius: 8, height: 30 }]}>
          <Pressable accessibilityLabel="Remove one" onPress={onRemove} style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 16, fontWeight: "700", color: pal.white }}>−</Text></Pressable>
          <Text style={{ paddingHorizontal: 6, fontSize: 12, fontWeight: "700", color: pal.white }}>{tier.count} {tier.unit ?? "pack"}</Text>
          <Pressable accessibilityLabel="Add one" onPress={onAdd} style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 16, fontWeight: "700", color: pal.white }}>+</Text></Pressable>
        </View>
      ) : (
        <Pressable accessibilityLabel="Add" onPress={onAdd} style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: t.brand, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 18, fontWeight: "700", color: pal.white }}>+</Text></Pressable>
      )}
      {tier.best ? <View style={{ position: "absolute", top: -10.5, right: 8.5, backgroundColor: lit.bestValue, borderRadius: 5, paddingVertical: 3, paddingHorizontal: 8 }}><Text style={{ fontSize: 11, lineHeight: lh(11), letterSpacing: 0.44, fontWeight: "800", color: pal.white }}>BEST VALUE</Text></View> : null}
    </View>
  );
}

/** .v2-item-card: 120 px photo column (purple gradient behind, Pre-order tag), body 10/12 padding with 4 px gaps, tier rows. */
export function ItemCard({ photo, name, size, desc, limit, popular, preorder, children, onPress }: { photo?: string | null; name: string; size?: string | null; desc?: string | null; limit?: string | null; popular?: boolean; preorder?: boolean; children: React.ReactNode; onPress?: () => void }) {
  const t = useTheme();
  const dark = useIsDark();
  return (
    <Pressable onPress={onPress} style={[{ flexDirection: "row", marginHorizontal: 16, backgroundColor: t.bg, borderRadius: 12, overflow: "hidden" }, shadowCss(`0px 1px 2px 0px ${pal.a0_0_0_025_005}`)]}>
      <View style={[{ width: 120 }, grad(lit.itemImgGrad)]}>
        {photo ? <Image source={{ uri: photo }} style={{ position: "absolute", inset: 0 } as any} resizeMode="cover" /> : null}
        {preorder ? <View style={{ position: "absolute", top: 6, left: 6, backgroundColor: pal.hF3E8FF, borderRadius: 4, paddingVertical: 2, paddingHorizontal: 6 }}><Text style={{ fontSize: 11, lineHeight: 11, fontWeight: "600", color: t.purple }}>Pre-order</Text></View> : null}
      </View>
      <View style={{ flex: 1, paddingTop: 10, paddingBottom: 2, paddingHorizontal: 12, gap: 2 }}>
        {popular ? <View style={{ alignSelf: "flex-start", marginTop: 3, marginBottom: 6, backgroundColor: t.orange, borderRadius: 5, paddingVertical: 3, paddingHorizontal: 8 }}><Text style={{ fontSize: 11, lineHeight: 13.2, letterSpacing: 0.44, fontWeight: "800", color: pal.white }}>MOST POPULAR</Text></View> : null}
        <Text style={{ fontSize: 13, lineHeight: 17.55, fontWeight: "600", textTransform: "capitalize" }}>{name}</Text>
        {size ? <Text style={{ fontSize: 11, lineHeight: lh(11), fontWeight: "500", color: t.ink3 }}>{size}</Text> : null}
        {desc ? <Text style={{ fontSize: 14, lineHeight: 19.6, fontWeight: "700" }}>{desc}</Text> : null}
        {limit ? <Text style={{ marginTop: -1, fontSize: 12, lineHeight: lh(12), color: t.ink3 }}>{limit}</Text> : null}
        <View style={{ marginTop: 2 }}>{children}</View>
      </View>
    </Pressable>
  );
}
