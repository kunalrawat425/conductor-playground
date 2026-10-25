import { haversineKm } from "./order-pricing";

/** Hyperlocal areas with coordinates and delivery radius. */
export const AREAS = {
  thane: {
    name: "Thane",
    lat: 19.2183,
    lng: 72.9781,
    radius: 9, // km
    slug: "thane",
    metaDescription: "Order fresh fish online in Thane: pomfret, surmai, bombil and more from local sellers. Home delivery to Majiwada, Pokhran Road and Vartak Nagar. See today's prices, or pre-order tonight.",
    contentHeadline: "Fresh Fish Home Delivery in Thane",
    contentSubheading: "Order fish online from local Thane sellers: same-day, or pre-order tonight for tomorrow",
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
  // Thane neighbourhoods buyers search for (founder, 25 Oct). Sellers shown = those whose delivery
  // radius covers the neighbourhood centre (byDeliveryRadius), so a page never claims coverage we don't have.
  majiwada: {
    name: "Majiwada",
    lat: 19.2137,
    lng: 72.9796,
    radius: 10, // km
    slug: "majiwada",
    byDeliveryRadius: true,
    metaDescription: "Order fresh fish online in Majiwada, Thane: pomfret, surmai, rawas, prawns from local sellers, cleaned and cut. Home delivery in a 2-hour slot, or pre-order tonight.",
    contentHeadline: "Fresh Fish Home Delivery in Majiwada",
    contentSubheading: "Local Thane sellers deliver to Majiwada and Pokhran Road: same-day or pre-order",
    keywords: [],
  },
  "ghodbunder-road": {
    name: "Ghodbunder Road",
    lat: 19.247,
    lng: 72.969,
    radius: 10, // km
    slug: "ghodbunder-road",
    byDeliveryRadius: true,
    metaDescription: "Fresh fish delivery on Ghodbunder Road, Thane: Patlipada, Hiranandani Estate, Kasarvadavali and Brahmand. Order online from local sellers, cleaned and cut your way.",
    contentHeadline: "Fresh Fish Home Delivery on Ghodbunder Road",
    contentSubheading: "Order fish online for Patlipada, Hiranandani Estate, Kasarvadavali and Brahmand",
    keywords: [],
  },
  kolshet: {
    name: "Kolshet",
    lat: 19.234,
    lng: 72.987,
    radius: 10, // km
    slug: "kolshet",
    byDeliveryRadius: true,
    metaDescription: "Order fresh fish online in Kolshet and Dhokali, Thane, from local sellers. Pomfret, surmai, bangda, prawns, cleaned and cut, delivered in your slot or pre-ordered for tomorrow.",
    contentHeadline: "Fresh Fish Home Delivery in Kolshet & Dhokali",
    contentSubheading: "Local Thane sellers deliver to Kolshet Road and Dhokali: same-day or pre-order",
    keywords: [],
  },
  manpada: {
    name: "Manpada",
    lat: 19.241,
    lng: 72.9665,
    radius: 10, // km
    slug: "manpada",
    byDeliveryRadius: true,
    metaDescription: "Fresh fish online in Manpada, Thane: order pomfret, surmai, rawas and prawns from local sellers, cleaned and cut, with home delivery or a pre-order for tomorrow morning.",
    contentHeadline: "Fresh Fish Home Delivery in Manpada",
    contentSubheading: "Order fish online from local Thane sellers who deliver to Manpada",
    keywords: [],
  },
  mulund: {
    name: "Mulund",
    lat: 19.172,
    lng: 72.956,
    radius: 10, // km
    slug: "mulund",
    byDeliveryRadius: true,
    metaDescription: "Order fresh fish online in Mulund East and West from local sellers on Relifish. Pomfret, surmai, bombil, bangda, cleaned and cut, delivered in a 2-hour slot or pre-ordered.",
    contentHeadline: "Fresh Fish Home Delivery in Mulund",
    contentSubheading: "Local sellers deliver to Mulund East and Mulund West: same-day or pre-order",
    keywords: [],
  },
} as const;

export type AreaSlug = keyof typeof AREAS;

export function getAreaBySlug(slug: string): (typeof AREAS)[AreaSlug] | null {
  if (slug in AREAS) {
    return AREAS[slug as AreaSlug];
  }
  return null;
}

type AreaSeller = { lat?: number | null; lng?: number | null; location?: string | null; location_name?: string | null; delivery_rad?: number | string | null };

/** Active sellers listed on an area page: within the area radius and matching one of its keywords, nearest first. */
export function sellersForArea<T extends AreaSeller>(area: (typeof AREAS)[AreaSlug], sellers: T[]): (T & { distanceKm: number })[] {
  return sellers
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ ...s, distanceKm: haversineKm(area.lat, area.lng, s.lat!, s.lng!) }))
    .filter((s) => {
      if ("byDeliveryRadius" in area) return Number(s.delivery_rad) > 0 && s.distanceKm <= Number(s.delivery_rad);
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
    if ("byDeliveryRadius" in a) continue; // neighbourhood pages (Majiwada, Mulund…) never relabel a seller's city
    const d = haversineKm(a.lat, a.lng, Number(lat), Number(lng));
    if (d <= a.radius && (!best || d < best.d)) best = { name: a.name, d };
  }
  return best?.name ?? null;
}

/**
 * Neighbourhoods per area (approximate centre points). Only the ones inside a live seller's delivery
 * radius are shown on the area page, so the list never claims coverage a seller doesn't offer.
 */
export const LOCALITIES: Record<string, [string, number, number][]> = {
  thane: [
    ["Hiranandani Estate", 19.2578, 72.9706], ["Manpada", 19.241, 72.9665], ["Kasarvadavali", 19.2717, 72.9677],
    ["Patlipada (Ghodbunder Road)", 19.247, 72.969], ["Brahmand", 19.256, 72.981], ["Kolshet", 19.234, 72.987],
    ["Majiwada", 19.2137, 72.9796], ["Balkum", 19.223, 72.977], ["Vasant Vihar", 19.227, 72.96],
    ["Vartak Nagar", 19.2065, 72.958], ["Lokmanya Nagar", 19.214, 72.943], ["Wagle Estate", 19.205, 72.95],
    ["Naupada", 19.193, 72.9715], ["Thane Station area", 19.186, 72.975], ["Kopri", 19.1855, 72.989], ["Kalwa", 19.2, 73.0],
  ],
  tardeo: [
    ["Tardeo", 18.972, 72.814], ["Grant Road", 18.963, 72.816], ["Malabar Hill", 18.954, 72.8], ["Breach Candy", 18.97, 72.805],
    ["Mahalaxmi", 18.983, 72.821], ["Byculla", 18.979, 72.833], ["Marine Lines", 18.945, 72.823], ["Churchgate", 18.935, 72.827],
    ["Colaba", 18.9067, 72.8147], ["Lower Parel", 18.996, 72.83], ["Worli", 19.017, 72.817], ["Prabhadevi", 19.016, 72.829],
  ],
  majiwada: [["Majiwada", 19.2137, 72.9796], ["Pokhran Road", 19.219, 72.966], ["Balkum", 19.223, 72.977], ["Vartak Nagar", 19.2065, 72.958], ["Kapurbawdi", 19.214, 72.983]],
  "ghodbunder-road": [["Patlipada", 19.247, 72.969], ["Hiranandani Estate", 19.2578, 72.9706], ["Kasarvadavali", 19.2717, 72.9677], ["Brahmand", 19.256, 72.981], ["Manpada", 19.241, 72.9665]],
  kolshet: [["Kolshet Road", 19.234, 72.987], ["Dhokali", 19.229, 72.982], ["Balkum", 19.223, 72.977], ["Brahmand", 19.256, 72.981]],
  manpada: [["Manpada", 19.241, 72.9665], ["Tikuji-ni-wadi", 19.239, 72.958], ["Patlipada", 19.247, 72.969], ["Vasant Vihar", 19.227, 72.96]],
  mulund: [["Mulund West", 19.1726, 72.9425], ["Mulund East", 19.1711, 72.9586], ["Mulund Colony", 19.1786, 72.9346], ["Nahur", 19.154, 72.948]],
  kamothe: [
    ["Kamothe", 19.02, 73.096], ["Kalamboli", 19.03, 73.1], ["Kharghar", 19.047, 73.07], ["Khanda Colony", 19.004, 73.106],
    ["New Panvel", 18.998, 73.12], ["Panvel", 18.989, 73.117],
  ],
};

/** Localities of an area that at least one of these sellers covers (within its delivery radius). */
export function coveredLocalities(slug: string, sellers: { lat?: number | null; lng?: number | null; delivery_rad?: number | string | null }[]): string[] {
  return (LOCALITIES[slug] ?? [])
    .filter(([, lat, lng]) => sellers.some((s) => s.lat != null && s.lng != null && Number(s.delivery_rad) > 0 && haversineKm(lat, lng, Number(s.lat), Number(s.lng)) <= Number(s.delivery_rad)))
    .map(([name]) => name);
}
