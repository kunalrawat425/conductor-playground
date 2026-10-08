import type { ListingPriceOption } from "./listing-pricing";

export type Availability = "InStock" | "PreOrder" | "OutOfStock";

export interface SpeciesListing {
  is_available?: boolean | null;
  is_preorder_enabled?: boolean | null;
  is_order_paused?: boolean | null;
  weight_avail?: number | string | null;
  pricing_options?: ListingPriceOption[] | null;
}

export interface SpeciesOffer {
  availability: Availability;
  lowPrice: number;
  highPrice: number;
  offerCount: number;
}

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * One fish from one seller can have several listings (sizes / kg vs piece) and tiers.
 * Same-day stock wins (InStock, tier prices); otherwise pre-order (PreOrder, min–max range);
 * otherwise OutOfStock with the last listed prices. Null when nothing is priced.
 */
export function speciesOffer(listings: SpeciesListing[]): SpeciesOffer | null {
  const opts = (l: SpeciesListing) => l.pricing_options ?? [];
  const sameDay = listings.filter((l) => l.is_available && !l.is_order_paused && Number(l.weight_avail) > 0);
  const preorder = listings.filter((l) => l.is_preorder_enabled);

  let availability: Availability;
  let prices: number[];
  if (sameDay.length) {
    availability = "InStock";
    prices = sameDay.flatMap((l) => opts(l).map((o) => o.price));
  } else if (preorder.length) {
    availability = "PreOrder";
    prices = preorder.flatMap((l) => opts(l).flatMap((o) => [o.preorder_price_min ?? o.price, o.preorder_price_max ?? o.price]));
  } else {
    availability = "OutOfStock";
    prices = listings.flatMap((l) => opts(l).map((o) => o.price));
  }
  prices = prices.filter(positive);
  if (!prices.length) return null;
  return { availability, lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: prices.length };
}

/** schema.org Product for a single fish page (Google product snippets / merchant listings). */
export function productJsonLd(p: {
  name: string;
  description: string;
  url: string;
  image?: string;
  sellerName: string;
  offer: SpeciesOffer;
}) {
  const base = {
    priceCurrency: "INR",
    availability: `https://schema.org/${p.offer.availability}`,
    seller: { "@type": "Organization", name: p.sellerName },
    url: p.url,
  };
  const offers =
    p.offer.lowPrice === p.offer.highPrice
      ? { "@type": "Offer", price: p.offer.lowPrice, ...base }
      : { "@type": "AggregateOffer", lowPrice: p.offer.lowPrice, highPrice: p.offer.highPrice, offerCount: p.offer.offerCount, ...base };
  return {
    "@type": "Product",
    "@id": `${p.url}#product`,
    name: p.name,
    description: p.description,
    url: p.url,
    image: p.image,
    offers,
  };
}
