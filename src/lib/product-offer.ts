import type { ListingPriceOption } from "./listing-pricing";
import { hasSameDayToday, isPreorderShoppingWindow, type SellerTimingInput } from "./order-timing";

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
 * One listing, right now. Seller hours (IST) come first: on a day off or past closes_at there is no
 * same-day stock, only pre-order (if the seller takes pre-orders now and the listing allows it).
 * The merchant feed and /s/<slug>/<species> both use this, so Google sees one answer.
 */
export function listingAvailability(l: SpeciesListing, seller?: SellerTimingInput | null, nowMs?: number): Availability {
  if (seller && !hasSameDayToday(seller, nowMs)) {
    return l.is_preorder_enabled && isPreorderShoppingWindow(seller, nowMs) ? "PreOrder" : "OutOfStock";
  }
  if (l.is_available && !l.is_order_paused && Number(l.weight_avail) > 0) return "InStock";
  return l.is_preorder_enabled ? "PreOrder" : "OutOfStock";
}

/**
 * One fish from one seller can have several listings (sizes / kg vs piece) and tiers.
 * Same-day stock wins (InStock, tier prices); otherwise pre-order (PreOrder, the regular tier prices);
 * otherwise OutOfStock with the last listed prices. Null when nothing is priced.
 * Pass the seller to apply its hours (see listingAvailability).
 */
export function speciesOffer(listings: SpeciesListing[], seller?: SellerTimingInput | null, nowMs?: number): SpeciesOffer | null {
  const opts = (l: SpeciesListing) => l.pricing_options ?? [];
  const sameDay = listings.filter((l) => listingAvailability(l, seller, nowMs) === "InStock");
  const preorder = listings.filter((l) => listingAvailability(l, seller, nowMs) === "PreOrder");

  let availability: Availability;
  let prices: number[];
  if (sameDay.length) {
    availability = "InStock";
    prices = sameDay.flatMap((l) => opts(l).map((o) => o.price));
  } else if (preorder.length) {
    availability = "PreOrder";
    // Google and buyers see the seller's latest regular price, not the pre-order range
    // (the range is shown separately on the page; the final price lands inside it).
    prices = preorder.flatMap((l) => opts(l).map((o) => (positive(o.price) ? o.price : o.preorder_price_max ?? o.preorder_price_min ?? 0)));
  } else {
    availability = "OutOfStock";
    prices = listings.flatMap((l) => opts(l).map((o) => o.price));
  }
  prices = prices.filter(positive);
  if (!prices.length) return null;
  return { availability, lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: prices.length };
}

/** Perishable seafood: no returns (refund-policy page: refunds for cancellations, missing items or
 *  verified quality problems, to the original payment). Google merchant listings need this. */
export const RETURN_POLICY = {
  "@type": "MerchantReturnPolicy",
  applicableCountry: "IN",
  returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted",
  merchantReturnLink: "https://www.relifish.com/refund-policy",
};

/** Delivery fee a buyer can expect from this seller (per-km sellers: the maximum, radius × rate). */
export function sellerDeliveryFee(s: any): number {
  if (!s?.has_delivery || s.delivery_fee_enabled === false) return 0;
  return s.delivery_fee_type === "per_km" ? Math.ceil(Number(s.delivery_fee_per_km || 0) * Number(s.delivery_rad || 0)) : Number(s.delivery_fee_amount || 0);
}

/** schema.org OfferShippingDetails: India, seller's fee, same day or next day. */
export function shippingDetails(fee: number) {
  return {
    "@type": "OfferShippingDetails",
    shippingRate: { "@type": "MonetaryAmount", value: fee, currency: "INR" },
    shippingDestination: { "@type": "DefinedRegion", addressCountry: "IN" },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" },
      transitTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" },
    },
  };
}

/** schema.org Product for a single fish page (Google product snippets / merchant listings). */
export function productJsonLd(p: {
  name: string;
  description: string;
  url: string;
  image?: string;
  sellerName: string;
  offer: SpeciesOffer;
  /** Seller's delivery fee (sellerDeliveryFee); adds shipping details for merchant listings. */
  shippingFee?: number | null;
}) {
  const base = {
    priceCurrency: "INR",
    availability: `https://schema.org/${p.offer.availability}`,
    seller: { "@type": "Organization", name: p.sellerName },
    url: p.url,
    hasMerchantReturnPolicy: RETURN_POLICY,
    ...(p.shippingFee != null ? { shippingDetails: shippingDetails(p.shippingFee) } : {}),
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
    brand: { "@type": "Brand", name: "Relifish" },
    offers,
  };
}
