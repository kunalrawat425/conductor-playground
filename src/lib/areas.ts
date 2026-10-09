/** Hyperlocal areas with coordinates and delivery radius. */
export const AREAS = {
  thane: {
    name: "Thane",
    lat: 19.2183,
    lng: 72.9781,
    radius: 9, // km
    slug: "thane",
    metaDescription: "Order fresh fish online in Thane from local sellers on Relifish. Same-day orders or pre-order tonight for tomorrow; sellers deliver or keep it ready for pickup.",
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
    metaDescription: "Fresh fish delivery in Kandivali on Relifish is coming. Join the waitlist to hear when a local seller goes live.",
    contentHeadline: "Fresh Fish Delivery in Kandivali",
    contentSubheading: "No seller live in Kandivali yet: join the waitlist",
    keywords: ["kandivali"],
  },
  tardeo: {
    name: "Tardeo",
    lat: 18.9706,
    lng: 72.8108,
    radius: 8, // km
    slug: "tardeo",
    metaDescription: "Order fresh fish online in Tardeo and South Mumbai from local sellers on Relifish. Same-day orders or pre-order tonight for tomorrow.",
    contentHeadline: "Fresh Fish Delivery in Tardeo",
    contentSubheading: "Same-day & pre-order from local sellers in Tardeo and South Mumbai",
    keywords: ["tardeo", "tardeo", "south mumbai"],
  },
  kamothe: {
    name: "Kamothe",
    lat: 19.0325,
    lng: 73.0809,
    radius: 12, // km
    slug: "kamothe",
    metaDescription: "Order fresh fish online in Kamothe, Navi Mumbai from local sellers on Relifish. Same-day orders or pre-order tonight for tomorrow.",
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
