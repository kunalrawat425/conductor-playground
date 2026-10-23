/** Thane West, where every live seller is; typed areas are matched closest to here first. */
export const THANE_WEST = { lat: 19.2045, lng: 72.97 };

export type GeoHit = { lat: string | number; lon: string | number; display_name?: string };

/**
 * Nominatim returns several places for one name ("Manpada Thane West" → Manpada Road, Dombivli
 * before Manpada, Thane). Pick the hit nearest Thane West so a typed area lands where buyers mean.
 */
export function pickGeocodeHit(hits: GeoHit[] | null | undefined, near = THANE_WEST): GeoHit | null {
  let best: GeoHit | null = null, bestD = Infinity;
  for (const h of hits || []) {
    const lat = Number(h.lat), lng = Number(h.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const d = (lat - near.lat) ** 2 + ((lng - near.lng) * Math.cos((near.lat * Math.PI) / 180)) ** 2;
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

/** "Manpada Thane West" → "Manpada Thane": the map service doesn't know East/West suffixes. */
export function simplifyAreaQuery(q: string): string {
  return q.replace(/\b(west|east|\(w\)|\(e\))\b|\((w|e)\)/gi, " ").replace(/\s+/g, " ").replace(/[ ,]+$/, "").trim();
}
