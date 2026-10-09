import { cleanSellerName, sellerHref, stripContactInfo } from "./seller-display";
import { speciesOffer, type SpeciesListing, type SpeciesOffer } from "./product-offer";
import { optionBundleAmount } from "./listing-pricing";
import { areaNameForPoint } from "./areas";
import { hasGuide } from "./species-guides";

export interface HubRow {
  seller: string;
  area: string;
  href: string;
  offer: SpeciesOffer;
  /** Price per kg when the seller sells this fish by weight (packs converted to ₹/kg). */
  perKg: { low: number; high: number } | null;
}

/** ₹/kg range over the same listings the offer uses (same-day stock first, else pre-order). Null if sold only by piece. */
export function perKgRange(listings: SpeciesListing[]): { low: number; high: number } | null {
  const sameDay = listings.filter((l) => l.is_available && !l.is_order_paused && Number(l.weight_avail) > 0);
  const pre = listings.filter((l) => l.is_preorder_enabled);
  const useSame = sameDay.length > 0;
  const set = useSame ? sameDay : pre.length ? pre : listings;
  const vals: number[] = [];
  for (const l of set) for (const o of l.pricing_options ?? []) {
    if (o.unit !== "kg") continue;
    const kg = optionBundleAmount(o);
    const ps = [o.price > 0 ? o.price : o.preorder_price_max ?? 0]; // latest regular price, never the pre-order range
    for (const p of ps) if (typeof p === "number" && p > 0 && kg > 0) vals.push(Math.round(p / kg));
  }
  return vals.length ? { low: Math.min(...vals), high: Math.max(...vals) } : null;
}

/** A /fish/<species> hub with no buyer guide needs this many priced sellers to be indexable. */
export const HUB_MIN_SELLERS = 2;

/** Indexable (and in the sitemap) when 2+ sellers list it, or 1+ seller plus a written buyer guide. */
export function hubIndexable(species: string, sellerCount: number): boolean {
  return sellerCount >= HUB_MIN_SELLERS || (sellerCount >= 1 && hasGuide(species));
}

/** One row per active seller that lists this fish with a price (link goes to their single-fish page when it exists). */
export function hubRows(
  sellers: { id: string; name: string; location_name?: string | null; lat?: number | null; lng?: number | null }[],
  listings: (SpeciesListing & { seller_id: string; species: string })[],
  species: string,
): HubRow[] {
  const rows: HubRow[] = [];
  for (const s of sellers) {
    const mine = listings.filter((l) => l.seller_id === s.id && String(l.species).toLowerCase() === species);
    const offer = speciesOffer(mine);
    if (!offer) continue;
    const base = sellerHref(s.name, s.id);
    rows.push({
      seller: cleanSellerName(s.name),
      area: areaNameForPoint(s.lat, s.lng) || stripContactInfo(s.location_name) || "",
      href: base.startsWith("/s/") ? `${base}/${species}` : base,
      offer,
      perKg: perKgRange(mine),
    });
  }
  const rank = { InStock: 0, PreOrder: 1, OutOfStock: 2 } as const;
  return rows.sort((a, b) => rank[a.offer.availability] - rank[b.offer.availability] || a.offer.lowPrice - b.offer.lowPrice);
}
