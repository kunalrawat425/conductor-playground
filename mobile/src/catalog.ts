import * as Location from "expo-location";
import { supabase } from "./api";
import { SELLER_PUBLIC_COLUMNS } from "../../src/lib/seller-columns";
import { classifyPlacementAtOrderTime, timeLabel } from "../../src/lib/order-timing";
import { haversineKm } from "../../src/lib/order-pricing";
import { preorderDeliveryDates, dateLabelIST } from "../../src/lib/delivery-slots";

export type Seller = Record<string, any> & { id: string; name: string; km: number | null; placement: "same_day" | "preorder" | "closed" };
export type Listing = Record<string, any> & { id: string; seller_id: string; species: string; pricing_options: any[] };

const THANE = { lat: 19.2183, lng: 72.9781 };

/** Phone location, else Thane centre (where Relifish delivers). */
export async function myLocation(): Promise<{ lat: number; lng: number; fromPhone: boolean }> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === "granted") {
      // A GPS fix can hang indoors: last known position at once, else wait at most 6 s, else Thane.
      const p = (await Location.getLastKnownPositionAsync().catch(() => null))
        ?? await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
      if (p) return { lat: p.coords.latitude, lng: p.coords.longitude, fromPhone: true };
    }
  } catch {}
  return { ...THANE, fromPhone: false };
}

/** Live sellers that deliver to this point, nearest first, with what they sell — same rules as /shop. */
export async function loadShop(at: { lat: number; lng: number }) {
  const { data: sellers } = await supabase.from("sellers").select(SELLER_PUBLIC_COLUMNS).eq("is_active", true);
  const live = (sellers || []).filter((x: any) => !x.is_test && x.name !== "New Seller");
  const ids = live.map((x: any) => x.id);
  const { data: listings } = ids.length
    ? await supabase.from("fish_listings").select("*").in("seller_id", ids).is("deleted_at", null).or("is_available.eq.true,is_preorder_enabled.eq.true")
    : { data: [] as any[] };
  const now = Date.now();
  const withKm: Seller[] = live.map((x: any) => {
    const km = x.lat != null && x.lng != null ? haversineKm(at.lat, at.lng, Number(x.lat), Number(x.lng)) : null;
    return { ...x, km, placement: classifyPlacementAtOrderTime(x, now) as Seller["placement"] };
  });
  const reach = withKm.filter((x) => x.km == null || !x.delivery_rad || x.km <= Number(x.delivery_rad) + 0.5);
  reach.sort((a, b) => (a.placement === "closed" ? 1 : 0) - (b.placement === "closed" ? 1 : 0) || (a.km ?? 99) - (b.km ?? 99));
  return { sellers: reach, listings: (listings || []) as Listing[] };
}

export function statusText(x: Seller): { text: string; tone: "green" | "purple" | "grey" } {
  if (x.placement === "same_day") return { text: "Open now", tone: "green" };
  if (x.placement === "preorder") {
    // The real first delivery day (skips the seller's closed dates), e.g. "Pre-order · Sun 15 Nov".
    const first = preorderDeliveryDates(x as any, Date.now())[0];
    return { text: first ? `Pre-order · ${dateLabelIST(first)}` : "Pre-order", tone: "purple" };
  }
  return { text: x.opens_at ? `Opens ${timeLabel(x.opens_at)}` : "Closed", tone: "grey" };
}

// ───────────── Web parity: the /shop page's rules (src/pages/shop.astro loadSellers / applyFilters / renderFiltered) ─────────────
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { menuBySeller } from "../../src/lib/menu-order";
import { isPreorderShoppingWindow, isSellerEffectivelyOpen, preorderStatusLabel, todayDayName } from "../../src/lib/order-timing";
import { closedStatusLabel } from "../../src/lib/cart";
import { getSpeciesDisplay } from "../../src/lib/species";
import { formatBuyerMenuUnitSuffix, getListingPriceOptions } from "../../src/lib/listing-pricing";
import { resizedImageUrl, stripContactInfo } from "../../src/lib/seller-display";

export type BuyerLocation = { lat: number; lng: number; area: string };
const LOC_KEY = "rlf_buyer_location";
const store = {
  get: (k: string) => (Platform.OS === "web" ? Promise.resolve(globalThis.localStorage?.getItem(k) ?? null) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string) => (Platform.OS === "web" ? Promise.resolve(globalThis.localStorage?.setItem(k, v)) : SecureStore.setItemAsync(k, v)),
};
/** Saved area, else the phone's GPS named like the site does (Nominatim suburb), else Thane (founder, 5 Nov). */
export async function buyerLocation(): Promise<BuyerLocation> {
  const raw = await store.get(LOC_KEY).catch(() => null);
  if (raw) try { const o = JSON.parse(raw); if (o.lat && o.lng) return o; } catch {}
  const at = await myLocation();
  if (!at.fromPhone) return { lat: THANE.lat, lng: THANE.lng, area: "Thane" };
  const area = await reverseArea(at.lat, at.lng);
  const loc = { lat: at.lat, lng: at.lng, area };
  await saveBuyerLocation(loc);
  return loc;
}
export async function saveBuyerLocation(loc: BuyerLocation) { await store.set(LOC_KEY, JSON.stringify(loc)).catch(() => {}); }
export async function reverseArea(lat: number, lng: number): Promise<string> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, { headers: { "User-Agent": "Relifish-app" } });
    const d = await r.json();
    return d.address?.suburb || d.address?.neighbourhood || d.address?.city_district || d.address?.city || d.display_name?.split(",")[0] || "Your area";
  } catch { return "Your area"; }
}

export type ShopGroup = { seller: any; listings: any[]; allListings: any[]; dist: number | null; open: boolean; preorderMode: boolean; preorderAvailableToday: boolean; preorderLine: string | null };
const FISHTOKRI = "2f39dfce-15c0-4f9a-a5b3-e95280479dbd";
/** Same queries and grouping as shop.astro loadSellers(). */
export async function loadShopGroups(loc: BuyerLocation): Promise<ShopGroup[]> {
  const [{ data: listingsData }, { data: sellersData }] = await Promise.all([
    supabase.from("fish_listings").select(`*, seller:sellers(${SELLER_PUBLIC_COLUMNS})`).is("deleted_at", null).or("is_available.eq.true,is_preorder_enabled.eq.true"),
    supabase.from("sellers").select(SELLER_PUBLIC_COLUMNS).eq("is_active", true).neq("name", "New Seller"),
  ]);
  const byS = menuBySeller((listingsData || []) as any[], (l: any) => l.seller?.id);
  const groups = ((sellersData || []) as any[]).filter((s) => (byS.get(s.id) || []).length > 0 || s.accepts_preorder === true).map((s) => {
    const dist = s.lat != null && s.lng != null ? haversineKm(loc.lat, loc.lng, Number(s.lat), Number(s.lng)) : null;
    const raw = byS.get(s.id) || [];
    const days: string[] = Array.isArray(s.preorder_days) ? s.preorder_days : [];
    const open = isSellerEffectivelyOpen(s);
    const preorderMode = !open && isPreorderShoppingWindow(s);
    return {
      seller: s, allListings: raw, dist, open, preorderMode,
      listings: raw.filter((l: any) => (preorderMode ? l?.is_preorder_enabled === true : l?.is_available === true)),
      preorderAvailableToday: preorderMode || (days.length ? days.includes(todayDayName()) : !!s.accepts_preorder),
      preorderLine: s.accepts_preorder ? preorderStatusLabel(s) : null,
    };
  });
  groups.sort((a, b) => (a.open !== b.open ? (a.open ? -1 : 1) : a.dist != null && b.dist != null ? a.dist - b.dist : (b.seller.rating_avg || 0) - (a.seller.rating_avg || 0)));
  return groups;
}
export type ShopFilter = { time: null | "open" | "preorder"; fulfill: null | "pickup" | "delivery"; topRated: boolean; category: string };
/** shop.astro applyFilters() + renderFiltered() ordering (top rated, Fishtokri always second). */
export function filterGroups(groups: ShopGroup[], f: ShopFilter): ShopGroup[] {
  let out = groups.filter((g) => {
    const s = g.seller;
    if (g.dist == null) return false;
    const rad = Number(s.delivery_rad);
    if (g.dist > (rad > 0 ? rad : s.has_delivery ? 10 : 25)) return false;
    if (f.time === "open" && !g.open) return false;
    if (f.time === "preorder" && !g.preorderAvailableToday) return false;
    if (f.fulfill === "delivery" && !s.has_delivery) return false;
    if (f.category !== "all" && !(g.listings || []).some((l: any) => String(l.species || "").toLowerCase().includes(f.category))) return false;
    return true;
  });
  if (f.topRated) out = [...out].sort((a, b) => (b.seller.rating_avg || 0) - (a.seller.rating_avg || 0));
  const i = out.findIndex((g) => g.seller.id === FISHTOKRI);
  if (i !== -1 && i !== 1 && out.length > 1) { out = [...out]; const [ft] = out.splice(i, 1); out.splice(1, 0, ft); }
  return out;
}
/** buildCategoryStrip(): All Fish, then surmai / prawns / pomfret / crab when listed, then the rest by count (max 7). */
export function categoryIds(groups: ShopGroup[], linked = "all"): string[] {
  const counts: Record<string, number> = {};
  for (const g of groups) for (const l of g.listings || []) { const sp = String(l.species || "").toLowerCase().trim(); if (sp && sp !== "all") counts[sp] = (counts[sp] || 0) + 1; }
  const pri = ["surmai", "prawns", "pomfret", "crab"];
  const sorted = [...pri.filter((s) => counts[s] > 0), ...Object.entries(counts).filter(([id]) => !pri.includes(id)).sort((a, b) => b[1] - a[1]).map(([id]) => id)].slice(0, 7);
  if (linked !== "all" && counts[linked] && !sorted.includes(linked)) sorted.push(linked);
  return ["all", ...sorted];
}
const BASE_P = "https://witoghpdfocywiosmrzv.supabase.co/storage/v1/object/public/fish-photos";
/** shop.astro speciesPhotos (remote ones; the plate photos are bundled in src/ui/photos.ts). */
export const REMOTE_SPECIES_PHOTO: Record<string, string> = {
  bombil: BASE_P + "/ocean/11_bombil.jpg", shark: BASE_P + "/bombay/shark.webp", salmon: BASE_P + "/bombay/salmon.webp", halwa: BASE_P + "/bombay/halwa.jpg",
  rohu: BASE_P + "/bombay/rohu.jpg", basa: BASE_P + "/bombay/basa.jpg", bhetki: BASE_P + "/bombay/bhetki.avif", ghol: BASE_P + "/bombay/ghol.png", boi: BASE_P + "/bombay/boi.jpg",
};
export const SPECIES_LABEL: Record<string, string> = { pomfret: "Pomfret", surmai: "Surmai", rawas: "Rawas", bangda: "Bangda", bombil: "Bombil", prawns: "Prawns", crab: "Crab", squid: "Squid", lobster: "Lobster", oyster: "Oyster", clam: "Clam", sardine: "Sardine", sole: "Sole", hilsa: "Hilsa", rohu: "Rohu" };
const HUES = ["sky", "green", "orange", "indigo"] as const;
export const pickHue = (seed: string) => { let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0; return HUES[h % 4]; };
/** One seller card's content, exactly as renderFiltered() builds it. */
export function sellerCardModel(g: ShopGroup) {
  const s = g.seller;
  const status = !g.open ? (g.preorderMode ? "closed-preorder" : "closed") : g.listings.length === 0 && g.preorderAvailableToday ? "pre-order-only" : "open";
  const [text, color] = status === "open" ? ["Open now · same day", "green"] : status === "closed-preorder" ? [g.preorderLine || "Pre-order", "indigo"] : status === "closed" ? [closedStatusLabel(s), "green"] : ["Pre-order only", "indigo"];
  const lst = g.allListings.length ? g.allListings : g.listings;
  const price = (l: any) => getListingPriceOptions(l)[0]?.price ?? (l.pricing_options as any[])?.[0]?.price ?? Infinity;
  const chip = (l: any) => {
    const opt = getListingPriceOptions(l)[0];
    const unit = opt ? (l.size_label ? "pack" : formatBuyerMenuUnitSuffix(opt).replace(/^\//, "")) : String(l.pricing_options?.[0]?.unit_label || "kg");
    const sp = String(l.species || "").toLowerCase();
    return { photo: l.photo_url ? resizedImageUrl(l.photo_url, 700) : REMOTE_SPECIES_PHOTO[sp] ?? null, name: getSpeciesDisplay(l.species), price: `₹${opt?.price ?? l.pricing_options?.[0]?.price ?? 0}/${unit}` };
  };
  const chips = lst.length === 0 ? [] : lst.length <= 2 ? lst.map(chip) : [chip([...lst].sort((a, b) => price(b) - price(a))[2] ?? lst[0])];
  const delivery = [Number(s.min_order_amount) > 0 ? `min ₹${s.min_order_amount}` : "", Number(s.free_delivery_above) > 0 ? `free delivery over ₹${s.free_delivery_above}` : ""].filter(Boolean).join(" · ") || "home delivery";
  return {
    id: s.id, name: cleanDisplayName(s.name), sub: [stripContactInfo(s.location_name || s.location || ""), g.dist != null ? `${g.dist.toFixed(1)} km` : ""].filter(Boolean).join(" · "),
    status: text as string, statusColor: color as "green" | "indigo", rating: s.rating_avg ? `${Number(s.rating_avg).toFixed(1)} ★` : null,
    cover: s.store_image_url || null, hue: pickHue(s.id), chips, more: lst.length >= 3 ? lst.length - 1 : 0,
    delivery: s.has_delivery ? delivery.charAt(0).toUpperCase() + delivery.slice(1) : null, pickupOnly: !s.has_delivery,
  };
}
/** shop.astro cleanDisplayName(): drop phone numbers / links from the seller's name. */
function cleanDisplayName(raw: string) {
  const TLD = "(com|in|net|org|store|shop|co|io|biz|info|fish)";
  const m = raw.match(new RegExp(`\\b([\\w-]+)\\.(?:[\\w-]+\\.)?${TLD}\\b`, "i"));
  const cand = m?.[1];
  const cleaned = stripContactInfo(raw);
  if (!cleaned && cand && !["www", "shop", "store", "mail", "app", "web", "m", "api"].includes(cand.toLowerCase())) return cand.charAt(0).toUpperCase() + cand.slice(1).toLowerCase();
  return cleaned;
}
