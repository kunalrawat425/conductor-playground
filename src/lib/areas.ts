/** Hyperlocal areas with coordinates and delivery radius. */
export const AREAS = {
  thane: {
    name: "Thane",
    lat: 19.2183,
    lng: 72.9781,
    radius: 9, // km
    slug: "thane",
    metaDescription: "Buy fresh fish online with same-day delivery in Thane. Direct from local sellers. No middleman, no cold storage.",
    contentHeadline: "Fresh Fish Delivery in Thane",
    contentSubheading: "Same-day & next-day pre-order from local Thane fish sellers",
    keywords: [],
  },
  kandivali: {
    name: "Kandivali",
    lat: 19.2043,
    lng: 72.8264,
    radius: 10, // km
    slug: "kandivali",
    metaDescription: "Order fresh fish online in Kandivali, Mumbai. Same-day delivery from trusted local sellers. No cold storage.",
    contentHeadline: "Fresh Fish Delivery in Kandivali",
    contentSubheading: "Daily catch delivered to your door in Kandivali",
    keywords: ["kandivali"],
  },
  tardeo: {
    name: "Tardeo",
    lat: 18.9706,
    lng: 72.8108,
    radius: 8, // km
    slug: "tardeo",
    metaDescription: "Buy fresh fish in Tardeo with fast delivery. Direct from local Mumbai fish sellers. Premium quality, best prices.",
    contentHeadline: "Fresh Fish Delivery in Tardeo",
    contentSubheading: "Quality fish from local sellers, delivered same-day in Tardeo",
    keywords: ["tardeo", "tardeo", "south mumbai"],
  },
  kamothe: {
    name: "Kamothe",
    lat: 19.0325,
    lng: 73.0809,
    radius: 12, // km
    slug: "kamothe",
    metaDescription: "Fresh fish delivery in Kamothe, Navi Mumbai. Pre-order next-day catch. Direct from local sellers, no middleman.",
    contentHeadline: "Fresh Fish Delivery in Kamothe",
    contentSubheading: "Same-day & pre-order fish delivery in Kamothe, Navi Mumbai",
    keywords: ["kamothe", "navi mumbai"],
  },
} as const;

export type AreaSlug = keyof typeof AREAS;

export function getAreaBySlug(slug: string): (typeof AREAS)[AreaSlug] | null {
  if (slug in AREAS) {
    return AREAS[slug as AreaSlug];
  }
  return null;
}
