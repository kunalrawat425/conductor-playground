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
