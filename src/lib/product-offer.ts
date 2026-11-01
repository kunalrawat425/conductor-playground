import type { ListingPriceOption } from "./listing-pricing";
import { hasSameDayToday, isPreorderShoppingWindow } from "./order-timing";
import { deliveryDaysAt, type SlotSeller } from "./delivery-slots";

export type Availability = "InStock" | "PreOrder" | "OutOfStock";

export interface SpeciesListing {
  is_available?: boolean | null;
  is_preorder_enabled?: boolean | null;
  is_order_paused?: boolean | null;
  weight_avail?: number | string | null;
  size_label?: string | null;
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
 * One listing, right now: the one availability rule for the merchant feed, /s/<slug>/<species>, the
 * seller menu schema, /fish/<species> and /fish-price-today. Seller hours (IST) come first: on a day
 * off or past closes_at there is no same-day stock, only pre-order (if the seller takes pre-orders now,
 * in the usual window or for a delivery-slot day, and the listing allows it).
 */
export function listingAvailability(l: SpeciesListing, seller?: SlotSeller | null, nowMs?: number): Availability {
  if (seller && !hasSameDayToday(seller, nowMs)) {
    const preorderOpen = isPreorderShoppingWindow(seller, nowMs) || deliveryDaysAt(seller, nowMs).some((d) => d.kind === "preorder");
    return l.is_preorder_enabled && preorderOpen ? "PreOrder" : "OutOfStock";
  }
  if (l.is_available && !l.is_order_paused && Number(l.weight_avail) > 0) return "InStock";
  return l.is_preorder_enabled ? "PreOrder" : "OutOfStock";
}

/**
 * The listings one seller's offer for one fish is priced from: same-day stock wins (InStock), else
 * pre-order (PreOrder), else every listing (OutOfStock, the last listed prices).
 */
export function offerListings<T extends SpeciesListing>(listings: T[], seller?: SlotSeller | null, nowMs?: number): { availability: Availability; listings: T[] } {
  const by = (a: Availability) => listings.filter((l) => listingAvailability(l, seller, nowMs) === a);
  const sameDay = by("InStock");
  if (sameDay.length) return { availability: "InStock", listings: sameDay };
  const preorder = by("PreOrder");
  if (preorder.length) return { availability: "PreOrder", listings: preorder };
  return { availability: "OutOfStock", listings };
}

/**
 * One fish from one seller can have several listings (sizes / kg vs piece) and tiers: the price
 * range over offerListings. Null when nothing is priced. Pass the seller to apply its hours.
 */
export function speciesOffer(listings: SpeciesListing[], seller?: SlotSeller | null, nowMs?: number): SpeciesOffer | null {
  const { availability, listings: set } = offerListings(listings, seller, nowMs);
  const prices = set
    .flatMap((l) => (l.pricing_options ?? []).map((o) =>
      // Pre-order: Google and buyers see the seller's latest regular price, not the pre-order range
      // (the range is shown separately on the page; the final price lands inside it).
      availability === "PreOrder" && !positive(o.price) ? o.preorder_price_max ?? o.preorder_price_min ?? 0 : o.price))
    .filter(positive);
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
    // The seller's own fish (same brand as the merchant feed), not the marketplace.
    brand: { "@type": "Brand", name: p.sellerName },
    offers,
  };
}
