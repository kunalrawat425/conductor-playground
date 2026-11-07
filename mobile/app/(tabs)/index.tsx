/**
 * Home = the site's /shop (src/pages/shop.astro): header with location, Diwali ribbon, the sticky cluster (notifications /
 * pre-order banner, category circles, filter chips), "Verified sellers near you" + count, seller cards, home cart pill.
 * Same data and rules: loadShopGroups / filterGroups / categoryIds / sellerCardModel in src/catalog.ts.
 */
import { track } from "../../src/track";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, Linking, RefreshControl, ScrollView, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Constants from "expo-constants";
import { buyerLocation, categoryIds, filterGroups, loadShopGroups, REMOTE_SPECIES_PHOTO, sellerCardModel, SPECIES_LABEL, type BuyerLocation, type ShopFilter, type ShopGroup } from "../../src/catalog";
import { useCart } from "../../src/cart";
import { rupees, useTheme } from "../../src/theme";
import { AppHeader, DiwaliBanner } from "../../src/ui/chrome";
import { CartBubble, CategoryStrip, FilterChips, PreorderBanner, SectionHead, SellerCard } from "../../src/ui/shop";
import { EmptyState } from "../../src/ui/atoms";
import { Text } from "../../src/ui/base";
import { CATEGORY_PHOTOS } from "../../src/ui/photos";
import { LocationSheet } from "../../src/LocationSheet";

type Perm = "granted" | "denied" | "undetermined" | "unsupported";
async function notifPerm(): Promise<Perm> {
  if (Constants.executionEnvironment === "storeClient") return "unsupported";
  const N = await import("expo-notifications");
  const p = await N.getPermissionsAsync();
  return p.granted ? "granted" : p.canAskAgain ? "undetermined" : "denied";
}

export default function Home() {
  const t = useTheme();
  const cart = useCart();
  const [loc, setLoc] = useState<BuyerLocation | null>(null);
  const [groups, setGroups] = useState<ShopGroup[] | null>(null);
  const [f, setF] = useState<ShopFilter>({ time: null, fulfill: null, topRated: false, category: "all" });
  const [perm, setPerm] = useState<Perm>("unsupported");
  const [pickLoc, setPickLoc] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (l?: BuyerLocation) => {
    const at = l ?? (await buyerLocation());
    setLoc(at);
    setGroups(await loadShopGroups(at).catch(() => []));
  }, []);
  useEffect(() => { load(); track("shop_view"); }, [load]);
  useFocusEffect(useCallback(() => { notifPerm().then(setPerm); }, []));
  useEffect(() => { const s = AppState.addEventListener("change", (x) => x === "active" && notifPerm().then(setPerm)); return () => s.remove(); }, []);

  const shown = useMemo(() => (groups ? filterGroups(groups, f) : []), [groups, f]);
  const cats = useMemo(() => categoryIds(groups || [], f.category).map((id) => ({ id, name: id === "all" ? "All Fish" : SPECIES_LABEL[id] || id[0].toUpperCase() + id.slice(1), photo: CATEGORY_PHOTOS[id] ?? (REMOTE_SPECIES_PHOTO[id] ? { uri: REMOTE_SPECIES_PHOTO[id] } : CATEGORY_PHOTOS.all) })), [groups, f.category]);

  // The banner asks for notifications while that is undecided (shop.astro maybeAskNotifications), says how when blocked,
  // and otherwise is the pre-order banner that switches the Pre-order filter on.
  const banner = perm === "undetermined"
    ? { icon: "🔔", title: "Allow notifications", text: "Get the latest updates on fresh listings and prices", cta: "Allow", onPress: async () => { const N = await import("expo-notifications"); await N.requestPermissionsAsync(); const p = await notifPerm(); setPerm(p); if (p === "granted") import("../../src/push").then((m) => m.registerPush()); } }
    : perm === "denied"
      ? { icon: "🔕", title: "Notifications are off", text: "Turn them on to get fresh listings and prices first", cta: "How", onPress: () => Linking.openSettings() }
      : { icon: "🌙", title: "Pre-order fresh fish", text: "Pre-order for tomorrow or later · pick a delivery time", cta: "Browse", onPress: () => setF((x) => ({ ...x, time: x.time === "preorder" ? null : "preorder" })) };

  const isActive = (k: string) => (k === "all" ? !f.time && !f.fulfill && !f.topRated : k === "open" || k === "preorder" ? f.time === k : k === "pickup" || k === "delivery" ? f.fulfill === k : f.topRated);
  const tap = (k: string) => setF((x) => (k === "all" ? { ...x, time: null, fulfill: null, topRated: false } : k === "open" || k === "preorder" ? { ...x, time: x.time === k ? null : (k as any) } : k === "pickup" || k === "delivery" ? { ...x, fulfill: x.fulfill === k ? null : (k as any) } : { ...x, topRated: !x.topRated }));
  const items = cart.lines.reduce((n, l) => n + l.packs, 0);
  const cartSeller = groups?.find((g) => g.seller.id === cart.seller?.id)?.seller;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg2 }}>
      <AppHeader area={loc?.area || "Set location"} onLocation={() => setPickLoc(true)} />
      <ScrollView stickyHeaderIndices={[1]} contentContainerStyle={{ paddingBottom: items ? 96 : 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(loc ?? undefined); setRefreshing(false); }} />}>
        <DiwaliBanner />
        <View style={{ backgroundColor: t.bg2, paddingTop: 8, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <PreorderBanner {...banner} />
          <View style={{ marginTop: 6 }}><CategoryStrip items={cats} active={f.category} onPick={(id) => setF((x) => ({ ...x, category: id }))} /></View>
          <FilterChips isActive={isActive} onPress={tap} chips={[{ key: "all", label: "All" }, { key: "open", label: "Open now" }, { key: "preorder", label: "Pre-order" }, "sep", { key: "pickup", label: "Pickup" }, { key: "delivery", label: "Delivery" }, "sep", { key: "topRated", label: "Top rated ★" }]} />
        </View>
        <SectionHead title="Verified sellers near you" count={groups ? shown.length : "…"} />
        {!groups ? (
          <View style={{ alignItems: "center", gap: 12, paddingVertical: 48 }}><ActivityIndicator size="large" color={t.brand} /><Text style={{ fontSize: 14, fontWeight: "600", color: t.ink3 }}>Finding sellers near you…</Text></View>
        ) : shown.length === 0 ? (
          <EmptyState icon="🎣" title="Not serviceable in your area yet" desc="We're adding new sellers. Join the waitlist and we'll notify you when a seller goes live near you." cta="Join waitlist →" onCta={() => Linking.openURL("https://www.relifish.com/#wl-form")} ghost="📞 Call us →" onGhost={() => Linking.openURL("tel:+919152207607")} />
        ) : (
          <View style={{ gap: 12 }}>{shown.map((g) => { const m = sellerCardModel(g); return <SellerCard key={m.id} {...m} onPress={() => router.push(`/seller/${m.id}`)} />; })}</View>
        )}
      </ScrollView>
      {items ? (
        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 12, alignItems: "center" }}>
          <CartBubble home line={`${items} item${items !== 1 ? "s" : ""} · ${rupees(cart.total)}`} thumbs={[cartSeller?.logo_url || cartSeller?.store_image_url || null]} onPress={() => router.push(`/seller/${cart.seller!.id}?checkout=1`)} />
        </View>
      ) : null}
      <LocationSheet visible={pickLoc} current={loc} onClose={() => setPickLoc(false)} onPicked={(l) => { setPickLoc(false); setGroups(null); load(l); }} />
    </View>
  );
}
