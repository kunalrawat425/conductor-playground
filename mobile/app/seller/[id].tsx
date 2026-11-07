/**
 * Seller page = the site's /seller/[id] (src/pages/seller/[id].astro): page header (back · Relifish), SellerHero, schedule
 * strip, pre-order context banner, menu header, item cards with pack tiers, cart bubble + next-slot chip, bottom nav.
 * Same mode rules (open / pre-order / closed), listing filters, tags, stats and chip text as the site.
 */
import { track } from "../../src/track";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../src/api";
import { useCart } from "../../src/cart";
import { getListingPriceOptions, formatOptionMenuLabel, optionBundleAmount, optionDiscountPercentDisplay, optionHasDealDisplay } from "../../../src/lib/listing-pricing";
import { SELLER_PUBLIC_COLUMNS } from "../../../src/lib/seller-columns";
import { isPreorderShoppingWindow, isSellerEffectivelyOpen, preorderDeliveryDateIST, preorderStatusLabel, sameDayScheduleLabel, timeLabel } from "../../../src/lib/order-timing";
import { closedStatusLabel } from "../../../src/lib/cart";
import { dateLabelIST, deliveryDaysAt, nextSlotText, slotPreorderLabel, storePreorderLabel } from "../../../src/lib/delivery-slots";
import { areaNameForPoint } from "../../../src/lib/areas";
import { getSpeciesDisplay } from "../../../src/lib/species";
import { bestValueIndex, bundleGroups } from "../../../src/lib/combo-deals";
import { cleanSellerName, resizedImageUrl, stripContactInfo } from "../../../src/lib/seller-display";
import { compareMenuOrder } from "../../../src/lib/menu-order";
import { rupees, useTheme } from "../../src/theme";
import { AppHeader, BottomNav, BUYER_NAV } from "../../src/ui/chrome";
import { CartBubble, ItemCard, MenuHeader, ScheduleStrip, SellerHero, TierRow } from "../../src/ui/shop";
import { EmptyState } from "../../src/ui/atoms";
import { Text } from "../../src/ui/base";
import { Icon } from "../../src/ui/icons";
import { pal } from "../../src/theme/palette";

export default function SellerPage() {
  const { id, checkout } = useLocalSearchParams<{ id: string; checkout?: string }>();
  const t = useTheme();
  const cart = useCart();
  const insets = useSafeAreaInsets();
  const [seller, setSeller] = useState<any>(null);
  const [all, setAll] = useState<any[] | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: x }, { data: l }] = await Promise.all([
        supabase.from("sellers").select(SELLER_PUBLIC_COLUMNS).eq("id", id).maybeSingle(),
        supabase.from("fish_listings").select("*").eq("seller_id", id).is("deleted_at", null),
      ]);
      setSeller(x); track("seller_view", { seller_id: id });
      setAll(((l || []) as any[]).sort(compareMenuOrder));
    })();
  }, [id]);
  useEffect(() => { if (checkout && seller && cart.lines.length) router.push("/checkout"); }, [checkout, seller]); // eslint-disable-line

  const m = useMemo(() => {
    if (!seller || !all) return null;
    const now = Date.now();
    const open = isSellerEffectivelyOpen(seller, now);
    const accepts = !!seller.accepts_preorder;
    const slotDays = deliveryDaysAt(seller, now);
    const pre = !open && accepts && (isPreorderShoppingWindow(seller, now) || slotDays.length > 0);
    const closed = !open && !pre;
    const preorderOnly = Array.isArray(seller.open_days) && seller.open_days.length === 0;
    const slotLine = slotPreorderLabel(seller);
    const preDays = slotDays.filter((d: any) => d.kind === "preorder");
    const ist = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);
    const dayWord = (d: string) => (d === ist(now + 86_400_000) ? "tomorrow" : dateLabelIST(d));
    const deliveryFor = slotLine && preDays.length ? `${dayWord(preDays[0].date)}${preDays.length > 1 ? " or later" : ""}`
      : (() => { const d = pre ? preorderDeliveryDateIST(seller, now) || slotDays[0]?.date : null; return !d ? "tomorrow" : d === ist(now) ? "today" : dayWord(d); })();
    const listings = all.filter((l) => (open ? l.is_available === true && !l.is_order_paused : pre ? l.is_preorder_enabled === true : l.is_available === true));
    const tags = [accepts && pre ? "Pre-order available" : accepts ? "Pre-order" : null, !seller.has_delivery ? "Pickup only" : null, seller.has_delivery ? `${seller.delivery_rad || 5}km delivery` : null, seller.min_order_amount > 0 ? `Min ₹${seller.min_order_amount}` : null].filter(Boolean) as string[];
    // "Bundles · save more" (seller/[id].astro): combos grouped under their base fish; they get no card of their own.
    const bundles = closed ? [] : bundleGroups(listings as any, (l: any) => getSpeciesDisplay(l.species));
    const combos = bundles.filter((g) => g.sizes.length).flatMap((g) => g.combos);
    const hosted = new Set(combos.map((r) => r.listing.id));
    const hasCombo = (l: any) => (/\bcombo\b/i.test(`${l.species} ${l.size_label || ""}`) ? 1 : 0);
    const cards = listings.filter((l) => !hosted.has(l.id)).sort((a, b) => hasCombo(b) - hasCombo(a));
    return {
      open, pre, closed, preorderOnly, slotLine, deliveryFor, listings: cards, combos, tags, count: listings.length,
      preorderLine: accepts ? preorderStatusLabel(seller, now) : null,
      nextSlot: nextSlotText(seller, now), closedLabel: closedStatusLabel(seller, now),
      sameDay: sameDayScheduleLabel(seller), preSchedule: storePreorderLabel(seller),
      area: areaNameForPoint(seller.lat, seller.lng) || stripContactInfo(seller.location_name) || "",
    };
  }, [seller, all]);

  if (!seller || !m) return <View style={{ flex: 1, backgroundColor: t.bg2 }}><AppHeader variant="page" title="Relifish" onBack={() => router.back()} /><ActivityIndicator style={{ marginTop: 48 }} size="large" color={t.brand} /></View>;

  const mine = cart.seller?.id === seller.id ? cart.lines : [];
  const packsOf = (lid: string, oid: string) => mine.find((l) => l.listing_id === lid && l.option_id === oid)?.packs || 0;
  const items = mine.reduce((n, l) => n + l.packs, 0);
  const minGap = Number(seller.min_order_amount) > 0 ? Number(seller.min_order_amount) - cart.total : 0;
  const freeHit = Number(seller.free_delivery_above) > 0 && cart.total >= Number(seller.free_delivery_above);
  const chip = minGap > 0 ? { text: `Add ₹${minGap} more to checkout`, color: t.orange } : m.nextSlot ? { text: `${m.pre ? "" : ""} Next delivery slot: ${m.nextSlot}${freeHit ? " · free delivery" : ""}`, color: m.pre ? pal.h7C3AED : t.green } : null;
  const opensAt = timeLabel(seller.opens_at) || "5 AM", closesAt = timeLabel(seller.closes_at) || "11 AM";

  return (
    <View style={{ flex: 1, backgroundColor: t.bg2 }}>
      <AppHeader variant="page" title="Relifish" onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      <ScrollView contentContainerStyle={{ paddingBottom: items ? 170 : 16 }}>
        <SellerHero cover={seller.store_image_url ? resizedImageUrl(seller.store_image_url, 800) : null} logo={seller.logo_url || seller.store_image_url ? resizedImageUrl(seller.logo_url || seller.store_image_url, 320) : null}
          name={cleanSellerName(seller.name)} area={m.area} rating={seller.rating_avg > 0 ? `${Number(seller.rating_avg).toFixed(1)} ★` : null} tags={m.tags}
          stats={[{ v: String(m.listings.length), l: "Items" }, m.open ? { v: "Open", l: `Until ${closesAt}`, live: true } : m.pre ? { v: "Pre-order now", l: `for ${m.deliveryFor}`, live: true } : { v: "Closed", l: m.closedLabel || `Opens ${opensAt}` }]} />
        <ScheduleStrip sameDay={m.sameDay} preorder={m.preSchedule} />
        {m.pre && !m.slotLine ? (
          <View style={{ marginTop: 12, marginHorizontal: 16, padding: 12, paddingHorizontal: 14, backgroundColor: pal.hF3E8FF, borderWidth: 1, borderColor: pal.hDDD6FE, borderRadius: 12, flexDirection: "row", gap: 10, alignItems: "center" }}>
            <Icon name="moon" size={20} color={pal.h7C3AED} />
            <View style={{ flex: 1 }}><Text style={{ fontSize: 13, fontWeight: "700", color: pal.h7C3AED }}>{m.preorderLine || `Pre-ordering for ${m.deliveryFor}`}</Text><Text style={{ marginTop: 2, fontSize: 11, color: pal.h6D28D9 }}>For {m.deliveryFor}. Your order is reserved from that morning's fresh catch.</Text></View>
          </View>
        ) : !m.pre && m.preorderLine && !m.open ? (
          <View style={{ marginTop: 12, marginHorizontal: 16, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: pal.hF3E8FF, borderWidth: 1, borderColor: pal.hDDD6FE, borderRadius: 12 }}><Text style={{ fontSize: 13, fontWeight: "700", color: pal.h7C3AED }}>{m.preorderLine}</Text></View>
        ) : null}
        {m.listings.length === 0 ? (
          <View style={{ marginTop: 16 }}><EmptyState icon="search" title="No items available" desc={seller.accepts_preorder ? "Pre-order for tomorrow or later instead." : "Check back during opening hours."} cta={seller.accepts_preorder ? "Pre-order" : "Browse sellers"} onCta={() => router.replace("/")} /></View>
        ) : (
          <>
            <MenuHeader title={m.closed ? (m.preorderOnly ? "Menu (pre-orders paused)" : "Menu (Closed)") : m.pre ? "Pre-order Menu" : "Today's Menu"} count={m.count} />
            {m.combos.length ? (
              <View style={{ marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, paddingTop: 2, paddingBottom: 4, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
                <Text style={{ marginTop: 12, marginBottom: 10, fontSize: 12, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", color: t.ink3 }}>Bundles · save more</Text>
                {m.combos.map((r) => {
                  const l: any = r.listing; const o: any = r.opt;
                  const inStock = l.is_available === true && !l.is_order_paused && (l.weight_avail == null || Number(l.weight_avail) > 0);
                  if (m.pre ? l.is_preorder_enabled !== true : !inStock) return null;
                  const price = m.pre ? Number(o.preorder_price_max) || Number(o.preorder_price_min) || Number(o.price) || 0 : Number(o.price) || 0;
                  const count = packsOf(l.id, r.optId);
                  const line = { listing_id: l.id, species: l.species, option_id: r.optId, option_label: "pack", unit: o.unit || "kg", bundle: optionBundleAmount(o), price };
                  const set = (n: number) => { if (n > count) track("add_to_cart", { seller_id: seller.id }); cart.setPacks({ id: seller.id, name: seller.name }, line, Math.max(0, n)); };
                  return (
                    <View key={`${l.id}-${r.optId}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 8, marginTop: r.ribbon ? 6 : 0, borderWidth: 1.5, borderRadius: 12, borderColor: count ? t.brand : t.border, backgroundColor: count ? t.brandL : t.bg }}>
                      {l.photo_url ? <Image source={{ uri: resizedImageUrl(l.photo_url, 300)! }} style={{ width: 48, height: 48, borderRadius: 8 }} /> : null}
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, lineHeight: 19, fontWeight: "700" }}>{getSpeciesDisplay(l.species)}</Text>
                        <Text style={{ marginTop: 4, marginBottom: 6, fontSize: 12, lineHeight: 18.6, color: t.ink3 }}>{r.parts.join(" + ")}</Text>
                        <Text style={{ fontSize: 16, fontWeight: "800" }}>₹{price.toLocaleString("en-IN")}{Number(o.compare_at_price) > price ? <Text style={{ fontSize: 12, fontWeight: "500", color: t.ink4, textDecorationLine: "line-through" }}>  ₹{Number(o.compare_at_price).toLocaleString("en-IN")}</Text> : null}</Text>
                        {optionHasDealDisplay({ ...o, price } as any) ? <View style={{ alignSelf: "flex-start", marginTop: 4, backgroundColor: t.brand, borderRadius: 5, paddingVertical: 2, paddingHorizontal: 6 }}><Text style={{ fontSize: 11, fontWeight: "800", letterSpacing: 0.22, color: pal.white }}>{optionDiscountPercentDisplay({ ...o, price } as any)}% OFF</Text></View> : null}
                      </View>
                      {count ? (
                        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: t.brand, borderRadius: 8, height: 30 }}>
                          <Pressable accessibilityLabel="Remove one" onPress={() => set(count - 1)} style={{ width: 30, alignItems: "center" }}><Text style={{ fontSize: 16, fontWeight: "700", color: pal.white }}>−</Text></Pressable>
                          <Text style={{ paddingHorizontal: 6, fontSize: 12, fontWeight: "700", color: pal.white }}>{count} pack</Text>
                          <Pressable accessibilityLabel="Add one" onPress={() => set(count + 1)} style={{ width: 30, alignItems: "center" }}><Text style={{ fontSize: 16, fontWeight: "700", color: pal.white }}>+</Text></Pressable>
                        </View>
                      ) : <Pressable accessibilityLabel={`Add ${getSpeciesDisplay(l.species)}`} onPress={() => set(1)} style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: t.brand, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 18, fontWeight: "700", color: pal.white }}>+</Text></Pressable>}
                      {r.ribbon ? <View style={{ position: "absolute", top: -10, right: 10, backgroundColor: r.ribbon === "popular" ? pal.hEA580C : pal.h16A34A, borderRadius: 5, paddingVertical: 3, paddingHorizontal: 8 }}><Text style={{ fontSize: 11, fontWeight: "800", letterSpacing: 0.44, color: pal.white }}>{r.ribbon === "popular" ? "MOST POPULAR" : "BEST VALUE"}</Text></View> : null}
                    </View>
                  );
                })}
              </View>
            ) : null}
            <View style={{ gap: 10 }}>
              {m.listings.map((l) => {
                const opts = getListingPriceOptions(l);
                const best = bestValueIndex(opts as any);
                const isPre = m.pre && l.is_preorder_enabled === true;
                const canAdd = !m.closed;
                return (
                  <ItemCard key={l.id} photo={l.photo_url ? resizedImageUrl(l.photo_url, 300) : null} name={getSpeciesDisplay(l.species)} size={sizeLine(l)} desc={l.description} limit={limitText(l, opts[0])} preorder={isPre} popular={Array.isArray(l.pricing_options) && l.pricing_options.some((o: any) => o?.ribbon === "popular")}>
                    {opts.map((o: any, i: number) => {
                      const oid = o.id || `opt_${i}`;
                      const lo = Number(o.preorder_price_min) || 0, hi = Number(o.preorder_price_max) || 0;
                      const price = isPre ? hi || lo || Number(o.price) || 0 : Number(o.price) || 0;
                      const range = isPre && lo && hi && lo !== hi ? `₹${lo.toLocaleString("en-IN")}–₹${hi.toLocaleString("en-IN")}` : null;
                      const deal = !range && optionHasDealDisplay({ ...o, price } as any);
                      const b = Number(o.bundle_size);
                      const size = b && b !== 1 ? ` (${o.unit === "kg" && b < 1 ? `${Math.round(b * 1000)}g` : `${b}${o.unit === "kg" ? "kg" : "pc"}`})` : "";
                      const line = { listing_id: l.id, species: l.species, option_id: oid, option_label: o.label || formatOptionMenuLabel(o), unit: o.unit || "kg", bundle: optionBundleAmount(o), price };
                      const set = (n: number) => { if (n > count) track("add_to_cart", { seller_id: seller.id }); cart.setPacks({ id: seller.id, name: seller.name }, line, Math.max(0, n)); };
                      const count = packsOf(l.id, oid);
                      return <TierRow key={oid} first={i === 0} disabled={!canAdd}
                        tier={{ label: `${o.label || o.unit_label || o.unit || "unit"}${size}`, price: range ?? `₹${price}`, was: deal ? rupees(Number(o.compare_at_price)) : null, off: deal ? `${optionDiscountPercentDisplay({ ...o, price } as any)}% OFF` : null, best: i === best, count }}
                        onAdd={() => set(count + 1)} onRemove={() => set(count - 1)} />;
                    })}
                  </ItemCard>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
      {items ? (
        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 64 + insets.bottom + 12, alignItems: "center" }}>
          <CartBubble line={`${items} item${items !== 1 ? "s" : ""} · ${rupees(cart.total)}`} chip={chip?.text} chipColor={chip?.color} thumbs={[m.listings.find((l) => l.id === mine[0]?.listing_id)?.photo_url ? resizedImageUrl(m.listings.find((l) => l.id === mine[0]?.listing_id)!.photo_url, 300) : null]} onPress={() => router.push("/checkout")} />
        </View>
      ) : null}
      <BottomNav items={BUYER_NAV} active="home" onPress={(k) => router.navigate(k === "home" ? "/" : `/${k}` as any)} />
    </View>
  );
}

// Same rules as the site's menu card: the size line is left out when the description already says it; the daily
// limit is said in packs, the way buyers add it.
const SIZE: Record<string, string> = { small: "S", medium: "M", large: "L" };
function sizeLine(l: any) {
  const s = String(l.size_label || "").trim() || SIZE[l.fish_size] || "";
  return s && !String(l.description || "").toLowerCase().includes(s.toLowerCase()) ? s : "";
}
function limitText(l: any, o: any) {
  const lim = Number(l.buyer_daily_qty_limit);
  if (!(lim > 0) || !o) return "";
  const bs = Number(o.bundle_size) || 0;
  const n = o.unit === "kg" && bs > 0 && bs < 1 ? Math.floor(lim / bs + 1e-9) : lim;
  const unit = o.unit === "kg" && bs > 0 && bs < 1 ? (n === 1 ? "pack" : "packs") : o.unit === "piece" ? (l.size_label ? (lim === 1 ? "pack" : "packs") : "pcs") : "kg";
  return `Max ${n} ${unit} per buyer/day`;
}
