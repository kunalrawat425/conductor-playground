/**
 * The buyer's saved location, from wherever it was saved:
 *  - rlf_buyer_lat / rlf_buyer_lng / rlf_buyer_location (navbar map, /shop geolocation)
 *  - zepto_buyer_* (pre-rename keys, not yet migrated by lib/auth)
 *  - rlf_location / zepto_location JSON { lat, lng, name } (v1 LocationPicker)
 *  - v2_buyer_location JSON (read by LoginSheet; nothing writes it today)
 *  - the logged-in buyer's account (buyers.lat / lng / location_name, synced by AppShell)
 * Maps open on it; the default (central Mumbai) is only for buyers with nothing saved.
 */
export type SavedLocation = { lat: number; lng: number; area: string };
type Get = (key: string) => string | null;

function valid(lat: unknown, lng: unknown, area: unknown): SavedLocation | null {
  const la = Number(lat), ln = Number(lng);
  if (lat == null || lng == null || lat === "" || lng === "") return null;
  if (!Number.isFinite(la) || !Number.isFinite(ln) || (la === 0 && ln === 0)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln, area: typeof area === "string" ? area.trim() : "" };
}

function fromJson(raw: string | null): SavedLocation | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? valid(o.lat, o.lng, o.name ?? o.area ?? o.location_name) : null;
  } catch { return null; }
}

/** First saved location found in storage, or null. */
export function readSavedLocation(get: Get): SavedLocation | null {
  return valid(get("rlf_buyer_lat"), get("rlf_buyer_lng"), get("rlf_buyer_location"))
    || valid(get("zepto_buyer_lat"), get("zepto_buyer_lng"), get("zepto_buyer_location"))
    || fromJson(get("rlf_location"))
    || fromJson(get("zepto_location"))
    || fromJson(get("v2_buyer_location"));
}

/** Store as the canonical keys (what /shop, the seller page fee estimate and the account sync read). */
export function writeSavedLocation(set: (k: string, v: string) => void, loc: SavedLocation) {
  set("rlf_buyer_lat", String(loc.lat));
  set("rlf_buyer_lng", String(loc.lng));
  if (loc.area) set("rlf_buyer_location", loc.area);
  set("rlf_loc_synced", `${loc.lat},${loc.lng}`); // came from the account: nothing to sync back
}

/**
 * GPS is only a first-visit default: store it only if nothing is saved yet. The silent /shop
 * GPS lookup can finish after the buyer picked a spot on the map; it must not overwrite it.
 */
export function saveGpsDefault(get: Get, set: (k: string, v: string) => void, loc: SavedLocation): boolean {
  if (readSavedLocation(get)) return false;
  set("rlf_buyer_lat", String(loc.lat));
  set("rlf_buyer_lng", String(loc.lng));
  set("rlf_buyer_location", loc.area);
  return true;
}

const OLD_COPIES = ["zepto_buyer_lat", "zepto_buyer_lng", "zepto_buyer_location", "zepto_location", "v2_buyer_location"];

/**
 * The buyer confirmed a spot on the map: it replaces every stored copy (canonical keys, the v1
 * rlf_location JSON, old zepto_* keys that lib/auth would migrate back over it), so no older
 * copy can win it back.
 */
export function writeConfirmedLocation(set: (k: string, v: string) => void, remove: (k: string) => void, loc: SavedLocation) {
  set("rlf_buyer_lat", String(loc.lat));
  set("rlf_buyer_lng", String(loc.lng));
  set("rlf_buyer_location", loc.area);
  set("rlf_location", JSON.stringify({ lat: loc.lat, lng: loc.lng, name: loc.area }));
  for (const k of OLD_COPIES) remove(k);
}

const ls = () => (typeof localStorage === "undefined" ? null : localStorage);

/**
 * Saved location from this device, else from the buyer's account (new phone, cleared storage).
 * An account location is copied to this device so the header and seller list use it too.
 */
export async function loadSavedLocation(): Promise<SavedLocation | null> {
  const store = ls();
  if (!store) return null;
  const local = readSavedLocation((k) => store.getItem(k));
  if (local) return local;
  const buyerId = store.getItem("rlf_buyer_id");
  if (!buyerId) return null;
  try {
    const res = await fetch(`/api/buyer/profile?buyer_id=${encodeURIComponent(buyerId)}`);
    if (!res.ok) return null;
    const p = (await res.json())?.profile;
    const loc = p ? valid(p.lat, p.lng, p.location_name) : null;
    if (loc) writeSavedLocation((k, v) => store.setItem(k, v), loc);
    return loc;
  } catch { return null; }
}

/** Save a map pick on this device and, for a logged-in buyer, on their account right away. */
export async function saveConfirmedLocation(loc: SavedLocation): Promise<void> {
  const store = ls();
  if (!store) return;
  writeConfirmedLocation((k, v) => store.setItem(k, v), (k) => store.removeItem(k), loc);
  const buyerId = store.getItem("rlf_buyer_id");
  if (!buyerId) return;
  try {
    const res = await fetch("/api/buyer/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buyer_id: buyerId, updates: { lat: loc.lat, lng: loc.lng, location_name: loc.area || null } }),
    });
    // Same key AppShell's page-load sync uses; if this fails, that sync retries on the next page.
    if (res.ok) store.setItem("rlf_loc_synced", `${loc.lat},${loc.lng}`);
  } catch {}
}
