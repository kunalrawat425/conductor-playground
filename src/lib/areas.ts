import { haversineKm } from "./order-pricing";

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

type AreaSeller = { lat?: number | null; lng?: number | null; location?: string | null; location_name?: string | null };

/** Active sellers listed on an area page: within the area radius and matching one of its keywords, nearest first. */
export function sellersForArea<T extends AreaSeller>(area: (typeof AREAS)[AreaSlug], sellers: T[]): (T & { distanceKm: number })[] {
  return sellers
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ ...s, distanceKm: haversineKm(area.lat, area.lng, s.lat!, s.lng!) }))
    .filter((s) => {
      const addressText = `${s.location || ""} ${s.location_name || ""}`.toLowerCase();
      return s.distanceKm <= area.radius && (area.keywords.length === 0 || area.keywords.some((kw) => addressText.includes(kw.toLowerCase())));
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** The live area whose centre is within its radius of a point (e.g. a seller's shop), nearest first. */
export function areaNameForPoint(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null) return null;
  let best: { name: string; d: number } | null = null;
  for (const a of Object.values(AREAS)) {
    const d = haversineKm(a.lat, a.lng, Number(lat), Number(lng));
    if (d <= a.radius && (!best || d < best.d)) best = { name: a.name, d };
  }
  return best?.name ?? null;
}
