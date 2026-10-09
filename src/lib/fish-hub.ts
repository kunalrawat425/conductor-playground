import { cleanSellerName, sellerHref, stripContactInfo } from "./seller-display";
import { speciesOffer, type SpeciesListing, type SpeciesOffer } from "./product-offer";

export interface HubRow {
  seller: string;
  area: string;
  href: string;
  offer: SpeciesOffer;
}

/** A /fish/<species> hub is indexable only when at least this many sellers list the fish with a price. */
export const HUB_MIN_SELLERS = 2;

/** One row per active seller that lists this fish with a price (link goes to their single-fish page when it exists). */
export function hubRows(
  sellers: { id: string; name: string; location_name?: string | null }[],
  listings: (SpeciesListing & { seller_id: string; species: string })[],
  species: string,
): HubRow[] {
  const rows: HubRow[] = [];
  for (const s of sellers) {
    const offer = speciesOffer(listings.filter((l) => l.seller_id === s.id && String(l.species).toLowerCase() === species));
    if (!offer) continue;
    const base = sellerHref(s.name, s.id);
    rows.push({
      seller: cleanSellerName(s.name),
      area: stripContactInfo(s.location_name) || "",
      href: base.startsWith("/s/") ? `${base}/${species}` : base,
      offer,
    });
  }
  const rank = { InStock: 0, PreOrder: 1, OutOfStock: 2 } as const;
  return rows.sort((a, b) => rank[a.offer.availability] - rank[b.offer.availability] || a.offer.lowPrice - b.offer.lowPrice);
}
