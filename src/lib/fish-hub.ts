import { cleanSellerName, sellerHref, stripContactInfo } from "./seller-display";
import { offerListings, speciesOffer, type SpeciesListing, type SpeciesOffer } from "./product-offer";
import { optionBundleAmount } from "./listing-pricing";
import { areaNameForPoint } from "./areas";
import { hasGuide } from "./species-guides";
import type { SlotSeller } from "./delivery-slots";

export interface HubRow {
  seller: string;
  area: string;
  href: string;
  /** The seller's shop page (/s/<slug>, or /seller/<id> without a latin slug). */
  shopHref: string;
  offer: SpeciesOffer;
  /** Price per kg when the seller sells this fish by weight (packs converted to ₹/kg). */
  perKg: { low: number; high: number } | null;
  /** Sold by the pack/piece: the pack weight from the seller's label, e.g. "300–350 g" or "200–300 g to 400–500 g". */
  packWeight: string | null;
}

/** ₹/kg range over the same listings the offer uses (offerListings). Null if sold only by piece. */
export function perKgRange(listings: SpeciesListing[], seller?: SlotSeller | null, nowMs?: number): { low: number; high: number } | null {
  const vals: number[] = [];
  for (const l of offerListings(listings, seller, nowMs).listings) for (const o of l.pricing_options ?? []) {
    if (o.unit !== "kg") continue;
    const kg = optionBundleAmount(o);
    const p = o.price > 0 ? o.price : o.preorder_price_max ?? 0; // latest regular price, never the pre-order range
    if (typeof p === "number" && p > 0 && kg > 0) vals.push(Math.round(p / kg));
  }
  return vals.length ? { low: Math.min(...vals), high: Math.max(...vals) } : null;
}

const WEIGHT = /\d+(?:\.\d+)?(?:\s*[–-]\s*\d+(?:\.\d+)?)?\s*(?:kg|g)\b/i;

/** Pack weight of the cheapest and dearest pack, from the option label or the listing's size label. */
export function packWeight(listings: SpeciesListing[], seller?: SlotSeller | null, nowMs?: number): string | null {
  const packs = offerListings(listings, seller, nowMs).listings
    .flatMap((l) => (l.pricing_options ?? []).map((o) => ({
      price: o.price > 0 ? o.price : o.preorder_price_max ?? 0,
      weight: (String(o.label ?? "").match(WEIGHT) ?? String(l.size_label ?? "").match(WEIGHT))?.[0].replace(/\s*[–-]\s*/, "–").replace(/\s*(kg|g)$/i, " $1") ?? null,
    })))
    .filter((p) => p.price > 0)
    .sort((a, b) => a.price - b.price);
  if (!packs.length) return null;
  const lo = packs[0].weight, hi = packs[packs.length - 1].weight;
  return !lo && !hi ? null : !lo || !hi || lo === hi ? lo || hi : `${lo} to ${hi}`;
}

/** The rows a hubPriceRange is made of: the per-kg sellers when any sells by weight, else all. */
export function hubRangeRows(rows: HubRow[]): HubRow[] {
  const kg = rows.filter((r) => r.perKg);
  return kg.length ? kg : rows;
}

/**
 * One price range over several sellers' rows: ₹/kg when any of them sells by weight, else the pack prices.
 * Sellers selling by the pack are never folded into a ₹/kg range (show them with hubRowPriceText).
 * Null when there are no rows. Callers pass only the rows they mean (e.g. in stock today).
 */
export function hubPriceRange(rows: HubRow[]): { low: number; high: number; unit: "kg" | "pack" } | null {
  const kg = rows.filter((r) => r.perKg);
  if (kg.length) return { low: Math.min(...kg.map((r) => r.perKg!.low)), high: Math.max(...kg.map((r) => r.perKg!.high)), unit: "kg" };
  if (!rows.length) return null;
  return { low: Math.min(...rows.map((r) => r.offer.lowPrice)), high: Math.max(...rows.map((r) => r.offer.highPrice)), unit: "pack" };
}

/** "₹1200–₹1400/kg", "₹350 per pack". */
export function hubPriceText(r: { low: number; high: number; unit: "kg" | "pack" }): string {
  return `${r.low === r.high ? `₹${r.low}` : `₹${r.low}–₹${r.high}`}${r.unit === "kg" ? "/kg" : " per pack"}`;
}

/** One seller's own price: "₹2198–₹2199/kg" by weight, "₹375–₹1050 per pack (200–300 g to 400–500 g)" by the pack. */
export function hubRowPriceText(r: HubRow): string {
  if (r.perKg) return hubPriceText({ ...r.perKg, unit: "kg" });
  return hubPriceText({ low: r.offer.lowPrice, high: r.offer.highPrice, unit: "pack" }) + (r.packWeight ? ` (${r.packWeight})` : "");
}

/** "Thane", "Thane & Tardeo", "Thane, Tardeo & Kamothe": where these rows' sellers are, Thane first ("" for none). */
export function hubPlace(rows: { area: string }[]): string {
  const areas = [...new Set(rows.map((r) => r.area).filter(Boolean))].sort((a, b) => Number(b === "Thane") - Number(a === "Thane"));
  return areas.length <= 1 ? areas.join("") : `${areas.slice(0, -1).join(", ")} & ${areas[areas.length - 1]}`;
}

/** A /fish/<species> hub with no buyer guide needs this many priced sellers to be indexable. */
export const HUB_MIN_SELLERS = 2;

/** Indexable (and in the sitemap) when 2+ sellers list it, or 1+ seller plus a written buyer guide. */
export function hubIndexable(species: string, sellerCount: number): boolean {
  return sellerCount >= HUB_MIN_SELLERS || (sellerCount >= 1 && hasGuide(species));
}

/**
 * One row per active seller that lists this fish with a price (link goes to their single-fish page when it exists).
 * Pass the sellers' hours (SLOT_SELLER_COLUMNS) so availability matches the feed and the seller's own pages.
 */
export function hubRows(
  sellers: ({ id: string; name: string; location_name?: string | null; lat?: number | null; lng?: number | null } & SlotSeller)[],
  listings: (SpeciesListing & { seller_id: string; species: string })[],
  species: string,
  nowMs?: number,
): HubRow[] {
  const rows: HubRow[] = [];
  for (const s of sellers) {
    const mine = listings.filter((l) => l.seller_id === s.id && String(l.species).toLowerCase() === species);
    const offer = speciesOffer(mine, s, nowMs);
    if (!offer) continue;
    const base = sellerHref(s.name, s.id);
    const perKg = perKgRange(mine, s, nowMs);
    rows.push({
      seller: cleanSellerName(s.name),
      area: areaNameForPoint(s.lat, s.lng) || stripContactInfo(s.location_name) || "",
      href: base.startsWith("/s/") ? `${base}/${species}` : base,
      shopHref: base,
      offer,
      perKg,
      packWeight: perKg ? null : packWeight(mine, s, nowMs),
    });
  }
  const rank = { InStock: 0, PreOrder: 1, OutOfStock: 2 } as const;
  return rows.sort((a, b) => rank[a.offer.availability] - rank[b.offer.availability] || a.offer.lowPrice - b.offer.lowPrice);
}
