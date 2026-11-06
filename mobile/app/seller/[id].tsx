import { useEffect, useState } from "react";
import { Image, ScrollView, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../src/api";
import { useCart } from "../../src/cart";
import { statusText, type Listing, type Seller } from "../../src/catalog";
import { getListingPriceOptions, optionBundleAmount, formatOptionMenuLabel } from "../../../src/lib/listing-pricing";
import { SELLER_PUBLIC_COLUMNS } from "../../../src/lib/seller-columns";
import { classifyPlacementAtOrderTime } from "../../../src/lib/order-timing";
import { getSpeciesDisplay } from "../../../src/lib/species";
import { bestValueIndex } from "../../../src/lib/combo-deals";
import { radius, rupees, useTheme } from "../../src/theme";
import { Badge, Card, CartBar, ItemCard, Label, Loading, s, Text, TierRow } from "../../src/ui";

export default function SellerMenu() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const [seller, setSeller] = useState<Seller | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: x }, { data: l }] = await Promise.all([
        supabase.from("sellers").select(SELLER_PUBLIC_COLUMNS).eq("id", id).maybeSingle(),
        supabase.from("fish_listings").select("*").eq("seller_id", id).is("deleted_at", null).or("is_available.eq.true,is_preorder_enabled.eq.true"),
      ]);
      if (x) setSeller({ ...(x as any), km: null, placement: classifyPlacementAtOrderTime(x as any, Date.now()) as Seller["placement"] });
      setListings((l || []) as Listing[]);
    })();
  }, [id]);
  if (!seller) return <Loading />;

  const st = statusText(seller);
  const canOrder = seller.placement !== "closed";
  const mine = cart.seller?.id === seller.id ? cart.lines : [];
  const packsOf = (lid: string, oid: string) => mine.find((l) => l.listing_id === lid && l.option_id === oid)?.packs || 0;

  const items = mine.reduce((n, l) => n + l.packs, 0);
  const live = seller.placement !== "closed";

  return (
    <View style={{ flex: 1, backgroundColor: t.page }}>
      <Stack.Screen options={{ title: seller.name }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {/* .v2-sh-hero: avatar, name 20/800, sub 12 ink-3, tags, then the stats box */}
        <Card big>
          <View style={[s.row, { gap: 12, alignItems: "flex-start" }]}>
            {seller.logo_url || seller.store_image_url
              ? <Image source={{ uri: seller.logo_url || seller.store_image_url }} style={{ width: 60, height: 60, borderRadius: 14 }} />
              : <View style={{ width: 60, height: 60, borderRadius: 14, backgroundColor: t.brand, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 30 }}>🐟</Text></View>}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 20, fontWeight: "800", lineHeight: 24 }}>{seller.name}</Text>
              {seller.location_name ? <Text style={{ fontSize: 12, color: t.ink3, marginTop: 3, lineHeight: 16.8 }}>{seller.location_name}</Text> : null}
            </View>
          </View>
          <View style={[s.row, { marginTop: 12, gap: 6, flexWrap: "wrap" }]}>
            {seller.has_delivery ? <Badge text="Delivery" kind="blue" /> : null}
            {Number(seller.min_order_amount) > 0 ? <Badge text={`Min ${rupees(Number(seller.min_order_amount))}`} /> : null}
          </View>
          <View style={{ flexDirection: "row", marginTop: 16, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: radius.base, overflow: "hidden" }}>
            <View style={{ flex: 1, alignItems: "center", paddingVertical: 12, paddingHorizontal: 4, borderRightWidth: 1, borderRightColor: t.border }}>
              <Text style={{ fontSize: 15, fontWeight: "800" }}>{listings.length}</Text>
              <Text style={{ fontSize: 12, fontWeight: "500", color: t.ink4, marginTop: 2 }}>Items</Text>
            </View>
            <View style={{ flex: 1, alignItems: "center", paddingVertical: 12, paddingHorizontal: 4 }}>
              <View style={[s.row, { gap: 4 }]}>
                {live ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.green }} /> : null}
                <Text style={{ fontSize: 15, fontWeight: "800", color: live ? t.green : t.ink }}>{seller.placement === "same_day" ? "Open now" : live ? "Pre-order now" : "Closed"}</Text>
              </View>
              <Text style={{ fontSize: 12, fontWeight: "500", color: t.ink4, marginTop: 2 }}>{seller.placement === "preorder" ? `for ${st.text.replace("Pre-order · ", "")}` : seller.placement === "same_day" ? "Same-day delivery" : st.text}</Text>
            </View>
          </View>
        </Card>
        <View style={{ paddingHorizontal: 16, marginTop: 18 }}><Label>Menu</Label></View>
        {listings.map((l) => {
          const opts = getListingPriceOptions(l as any);
          const best = bestValueIndex(opts as any);
          // The site's menu rules (seller/[id].astro): in pre-order mode only pre-order fish can be added, at the
          // pre-order price (a min–max range when the seller set one); otherwise only fish in stock.
          const pre = seller.placement === "preorder" && l.is_preorder_enabled === true;
          const inStock = l.is_available === true && !l.is_order_paused && (l.weight_avail == null || Number(l.weight_avail) > 0);
          const canAdd = canOrder && (seller.placement === "preorder" ? pre : inStock);
          return (
            <ItemCard key={l.id} photo={l.photo_url} name={getSpeciesDisplay(l.species)} size={sizeLine(l)} desc={l.description} limit={limitText(l, opts[0])} preorder={pre} popular={opts.some((o: any) => o.ribbon === "popular")}>
              {opts.map((o: any, i: number) => {
                const oid = o.id || `opt_${i}`;
                const lo = Number(o.preorder_price_min) || 0, hi = Number(o.preorder_price_max) || 0;
                const price = pre ? hi || lo || Number(o.price) || 0 : Number(o.price) || 0;
                const range = pre && lo && hi && lo !== hi ? `₹${lo.toLocaleString("en-IN")}–₹${hi.toLocaleString("en-IN")}` : undefined;
                const line = { listing_id: l.id, species: l.species, option_id: oid, option_label: o.label || formatOptionMenuLabel(o), unit: o.unit || "kg", bundle: optionBundleAmount(o), price };
                // Site tier chip: label plus the pack size, e.g. "½ kg (500g)".
                const b = Number(o.bundle_size);
                const size = b && b !== 1 ? ` (${o.unit === "kg" && b < 1 ? `${Math.round(b * 1000)}g` : `${b}${o.unit === "kg" ? "kg" : "pc"}`})` : "";
                return <TierRow key={oid} best={i === best} label={`${o.label || o.unit_label || o.unit || "unit"}${size}`} option={{ price, compare_at_price: range ? null : o.compare_at_price }} priceText={range} count={packsOf(l.id, oid)} disabled={!canAdd} onChange={(n) => cart.setPacks({ id: seller.id, name: seller.name }, line, Math.max(0, n))} />;
              })}
            </ItemCard>
          );
        })}
      </ScrollView>
      {items ? <CartBar count={items} total={rupees(cart.total)} photo={listings.find((l) => l.id === mine[0]?.listing_id)?.photo_url} onPress={() => router.push("/checkout")} bottom={insets.bottom + 12} /> : null}
    </View>
  );
}

// Same rules as the site's menu card (src/pages/seller/[id].astro): the size line is left out when the
// description already says it; the daily limit is said in packs, the way buyers add it.
const SIZE: Record<string, string> = { small: "S", medium: "M", large: "L" };
function sizeLine(l: Listing) {
  const t = String(l.size_label || "").trim() || SIZE[l.fish_size] || "";
  return t && !String(l.description || "").toLowerCase().includes(t.toLowerCase()) ? t : "";
}
function limitText(l: Listing, o: any) {
  const lim = Number(l.buyer_daily_qty_limit);
  if (!(lim > 0) || !o) return "";
  const bs = Number(o.bundle_size) || 0;
  if (o.unit === "kg" && bs > 0 && bs < 1) { const n = Math.floor(lim / bs + 1e-9); return `${n} ${n === 1 ? "pack" : "packs"}`; }
  if (o.unit === "piece") return l.size_label ? `${lim} ${lim === 1 ? "pack" : "packs"}` : `${lim} pcs`;
  return `${lim} kg`;
}
