/**
 * Global cart — shared across all sellers.
 * Storage: single localStorage key `v2_cart_global` keyed by listing_id.
 * On checkout, items are grouped by seller_id and one order is placed per seller.
 *
 * Sync: when buyer is signed in, every mutation also POSTs/DELETEs to /api/buyer/cart.
 * On init for signed-in buyers, server cart is fetched and merged (server wins).
 *
 * Two carts per seller: same-day ("order window") and pre-order. A line's `mode` is part
 * of its key, so one listing can sit in both; lines saved before modes existed are same-day.
 * The seller page shows only the cart of the mode its menu is in; the other one is kept.
 */

import { classifyPlacementAtOrderTime, istDayStartISO, type SellerTimingInput } from "./order-timing";

export type CartMode = "same_day" | "preorder";

export type CartItem = {
  listing_id: string;
  seller_id: string;
  seller_name: string;
  /** Store photo from sellers.store_image_url */
  seller_image_url?: string | null;
  name: string;
  qty: number;
  qty_unit: string;
  price: number;
  pricing_option_id: string;
  pricing_label: string;
  added_at: number;
  /** Missing on lines saved before separate carts: those are same-day. */
  mode?: CartMode;
  /** Pack size when added; a different live bundle_size means the pack changed. */
  bundle_size?: number;
};

export type CartMap = Record<string, CartItem>;

export type SellerGroup = {
  seller_id: string;
  seller_name: string;
  seller_image_url?: string | null;
  items: CartItem[];
  subtotal: number;
  total_qty: number;
};

const KEY = "v2_cart_global";
const LEGACY_PREFIX = "v2_cart_"; // old per-seller keys

function getBuyerId(): string | null {
  try { return localStorage.getItem("rlf_buyer_id"); } catch { return null; }
}

export function lineMode(i: { mode?: string | null }): CartMode {
  return i.mode === "preorder" ? "preorder" : "same_day";
}

// The seller page pins default reads (getCart, groupBySeller, totals, clearCart) to its
// menu's mode, so code that doesn't pass a mode still sees only that cart. null = all lines.
let activeMode: CartMode | null = null;
export function setCartMode(mode: CartMode | null): void { activeMode = mode; }
// Lines validation removed during this page visit (see getRemovedLines).
let removedLines: RemovedLine[] = [];

function readAll(): CartMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

/** Lines of one mode (default: the page's mode, or every line when none is set). */
export function getCart(mode: CartMode | null = activeMode): CartMap {
  const all = readAll();
  if (!mode) return all;
  const out: CartMap = {};
  for (const k of Object.keys(all)) if (lineMode(all[k]) === mode) out[k] = all[k];
  return out;
}

function saveCart(c: CartMap) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
  // Notify listeners (e.g. CartBar in app shell)
  try { window.dispatchEvent(new CustomEvent("v2-cart-changed", { detail: { cart: c } })); } catch {}
}

/** Migrate any old per-seller carts (`v2_cart_<sellerId>`) into the global cart, then drop them. */
export function migrateLegacyCarts(opts: { sellerLookup?: (sellerId: string) => string }): void {
  try {
    const global = readAll();
    let touched = false;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LEGACY_PREFIX) || k === KEY) continue;
      const sellerId = k.slice(LEGACY_PREFIX.length);
      try {
        const old = JSON.parse(localStorage.getItem(k) || "{}");
        for (const lid of Object.keys(old)) {
          const item = old[lid];
          if (!item || global[lid]) continue; // global wins on conflict
          global[lid] = {
            listing_id: lid,
            seller_id: sellerId,
            seller_name: opts.sellerLookup?.(sellerId) || "",
            name: item.name || "",
            qty: item.qty || 0,
            qty_unit: item.unit || "kg",
            price: item.price || 0,
            pricing_option_id: item.pricing_option_id || "",
            pricing_label: item.pricing_label || "",
            added_at: Date.now(),
          };
          touched = true;
        }
      } catch {}
      toRemove.push(k);
    }
    toRemove.forEach((k) => { try { localStorage.removeItem(k); } catch {} });
    if (touched) saveCart(global);
  } catch {}
}

async function syncMutation(action: "upsert" | "remove" | "clear", payload?: any): Promise<void> {
  const buyerId = getBuyerId();
  if (!buyerId) return; // guest cart stays local-only
  try {
    if (action === "upsert") {
      await fetch("/api/buyer/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyer_id: buyerId, ...payload }),
      });
    } else if (action === "remove") {
      await fetch(`/api/buyer/cart?buyer_id=${buyerId}&listing_id=${payload.listing_id}&pricing_option_id=${encodeURIComponent(payload.pricing_option_id ?? "")}&placement_kind=${payload.placement_kind}`, { method: "DELETE" });
    } else if (action === "clear") {
      const sellerParam = payload?.seller_id
        ? `&seller_id=${payload.seller_id}${payload.placement_kind ? `&placement_kind=${payload.placement_kind}` : ""}`
        : "&clear=true";
      await fetch(`/api/buyer/cart?buyer_id=${buyerId}${sellerParam}`, { method: "DELETE" });
    }
  } catch {
    // Silent fail — local cart is source of truth, sync retries on next mutation
  }
}

/** Cart key = listing_id:pricing_option_id so different bundles of the same listing are separate lines.
 *  Pre-order lines get a "|preorder" suffix; same-day keys are unchanged (old carts keep working). */
function cartKey(listingId: string, pricingOptionId?: string, mode: CartMode = "same_day"): string {
  const base = pricingOptionId && pricingOptionId !== "default"
    ? `${listingId}:${pricingOptionId}`
    : listingId;
  return mode === "preorder" ? `${base}|preorder` : base;
}

export function lineKey(i: Pick<CartItem, "listing_id" | "pricing_option_id" | "mode">): string {
  return cartKey(i.listing_id, i.pricing_option_id, lineMode(i));
}

const upsertPayload = (i: CartItem) => ({
  listing_id: i.listing_id,
  pricing_option_id: i.pricing_option_id || "",
  qty: i.qty,
  qty_unit: i.qty_unit,
  price_snapshot: i.price,
  placement_kind: lineMode(i),
});
const removePayload = (i: CartItem) => ({
  listing_id: i.listing_id,
  pricing_option_id: i.pricing_option_id || "",
  placement_kind: lineMode(i),
});

export function addItem(item: Omit<CartItem, "qty" | "added_at"> & { qty?: number }): CartItem {
  let cart = readAll();

  // Single-seller cart: if the new item belongs to a different seller than what's
  // already in the cart, clear the old seller's items first. One seller per checkout.
  const existingSellers = new Set(Object.values(cart).map((i) => i.seller_id));
  if (existingSellers.size > 0 && !existingSellers.has(item.seller_id)) {
    cart = {};
    syncMutation("clear");
    try { window.dispatchEvent(new CustomEvent("v2-cart-seller-switched", { detail: { newSellerId: item.seller_id } })); } catch {}
  }

  const mode = lineMode(item);
  const key = cartKey(item.listing_id, item.pricing_option_id, mode);
  const existing = cart[key];
  const next: CartItem = existing
    ? { ...existing, qty: existing.qty + (item.qty ?? 1) }
    : { ...item, mode, qty: item.qty ?? 1, added_at: Date.now() };
  cart[key] = next;
  removedLines = removedLines.filter((r) => r.key !== key);
  saveCart(cart);
  syncMutation("upsert", upsertPayload(next));
  return next;
}

/** setQty/incQty/decQty/removeItem accept either a plain listing_id (backward compat)
 *  or a composite key "listing_id:pricing_option_id". They find the matching cart entry. */
function findCartKey(cart: CartMap, id: string): string | null {
  if (cart[id]) return id;
  // Legacy: try as listing_id (matches first entry for that listing, in the page's cart)
  const mode = activeMode ?? "same_day";
  for (const k of Object.keys(cart)) {
    if (lineMode(cart[k]) !== mode) continue;
    if (k === id || k.startsWith(id + ":") || cart[k].listing_id === id) return k;
  }
  return null;
}

export function setQty(id: string, qty: number): void {
  const cart = readAll();
  const key = findCartKey(cart, id);
  if (!key) return;
  if (qty <= 0) {
    const item = cart[key];
    delete cart[key];
    saveCart(cart);
    syncMutation("remove", removePayload(item));
    return;
  }
  cart[key].qty = qty;
  saveCart(cart);
  syncMutation("upsert", upsertPayload(cart[key]));
}

export function updateItemPrice(id: string, price: number): void {
  const cart = readAll();
  const key = findCartKey(cart, id);
  if (!key) return;
  if (cart[key].price === price) return;
  cart[key].price = price;
  saveCart(cart);
  syncMutation("upsert", upsertPayload(cart[key]));
}

export function incQty(id: string): void {
  const cart = readAll();
  const key = findCartKey(cart, id);
  if (!key) return;
  setQty(key, cart[key].qty + 1);
}

export function decQty(id: string): void {
  const cart = readAll();
  const key = findCartKey(cart, id);
  if (!key) return;
  setQty(key, cart[key].qty - 1);
}

export function removeItem(id: string): void {
  const cart = readAll();
  const key = findCartKey(cart, id);
  if (!key) return;
  const item = cart[key];
  delete cart[key];
  saveCart(cart);
  syncMutation("remove", removePayload(item));
}

/** With sellerId: that seller's lines of `mode` (default: the page's mode; null = both carts). */
export function clearCart(opts?: { sellerId?: string; mode?: CartMode | null }): void {
  const cart = readAll();
  if (opts?.sellerId) {
    const mode = opts.mode === undefined ? activeMode : opts.mode;
    for (const lid of Object.keys(cart)) {
      if (cart[lid].seller_id === opts.sellerId && (!mode || lineMode(cart[lid]) === mode)) delete cart[lid];
    }
    saveCart(cart);
    syncMutation("clear", { seller_id: opts.sellerId, placement_kind: mode || undefined });
  } else {
    saveCart({});
    syncMutation("clear");
  }
}

export function totalQty(cart: CartMap = getCart()): number {
  return Object.values(cart).reduce((s, i) => s + i.qty, 0);
}

export function totalPrice(cart: CartMap = getCart()): number {
  return Object.values(cart).reduce((s, i) => s + i.qty * i.price, 0);
}

export function groupBySeller(cart: CartMap = getCart()): SellerGroup[] {
  const groups: Record<string, SellerGroup> = {};
  for (const item of Object.values(cart)) {
    if (!groups[item.seller_id]) {
      groups[item.seller_id] = {
        seller_id: item.seller_id,
        seller_name: item.seller_name,
        seller_image_url: item.seller_image_url ?? null,
        items: [],
        subtotal: 0,
        total_qty: 0,
      };
    } else if (!groups[item.seller_id].seller_image_url && item.seller_image_url) {
      groups[item.seller_id].seller_image_url = item.seller_image_url;
    }
    groups[item.seller_id].items.push(item);
    groups[item.seller_id].subtotal += item.qty * item.price;
    groups[item.seller_id].total_qty += item.qty;
  }
  return Object.values(groups).sort((a, b) => b.subtotal - a.subtotal);
}

export function sellerCount(cart: CartMap = getCart()): number {
  const ids = new Set<string>();
  for (const item of Object.values(cart)) ids.add(item.seller_id);
  return ids.size;
}

/**
 * Hydrate cart from server when buyer signed in. Server wins on conflict.
 * Safe to call on every page load (no-op for guests).
 */
export async function hydrateFromServer(): Promise<void> {
  const buyerId = getBuyerId();
  if (!buyerId) return;
  try {
    const res = await fetch(`/api/buyer/cart?buyer_id=${buyerId}`);
    if (!res.ok) return;
    const data = await res.json();
    const items: any[] = data.items || [];
    if (items.length === 0) return;

    const local = readAll();
    for (const it of items) {
      // Server wins. Key by listing + price tier + mode exactly like addItem does —
      // writing local[listing_id] next to an existing "listing:opt" line made a
      // second line for the same item, i.e. two orders and two charges.
      // Legacy server rows have no tier: reuse the local line for that listing.
      const opt = it.pricing_option_id || "";
      // Before migration 079 the server has no mode (placement_kind null): keep a
      // local pre-order line's mode rather than duplicating it into the same-day cart.
      const mode: CartMode = it.placement_kind
        ? lineMode({ mode: it.placement_kind })
        : (local[cartKey(it.listing_id, opt, "preorder")] && !local[cartKey(it.listing_id, opt)] ? "preorder" : "same_day");
      const k = opt ? cartKey(it.listing_id, opt, mode) : (findCartKey(local, it.listing_id) ?? cartKey(it.listing_id, "", mode));
      local[k] = {
        listing_id: it.listing_id,
        seller_id: it.seller_id,
        seller_name: it.seller_name || local[k]?.seller_name || "",
        seller_image_url:
          it.seller_image_url
          ?? local[k]?.seller_image_url
          ?? null,
        // The name the buyer saw on the menu wins; the server only knows the species ("surmai").
        name: local[k]?.name || (s => s.charAt(0).toUpperCase() + s.slice(1))(String(it.species_display || it.name || "")),
        qty: Number(it.qty) || 0,
        qty_unit: it.qty_unit || "kg",
        price: Number(it.price_snapshot) || 0,
        pricing_option_id: opt || local[k]?.pricing_option_id || "",
        pricing_label: it.pricing_label || local[k]?.pricing_label || "",
        added_at: it.created_at ? new Date(it.created_at).getTime() : Date.now(),
        mode: local[k]?.mode ?? mode,
        bundle_size: local[k]?.bundle_size,
      };
    }
    saveCart(local);
  } catch {}
}

/** Push local cart to server (called after sign-in to capture guest cart). */
export async function pushLocalToServer(): Promise<void> {
  const buyerId = getBuyerId();
  if (!buyerId) return;
  for (const item of Object.values(readAll())) {
    await syncMutation("upsert", upsertPayload(item));
  }
}

/** A line validation took out of the cart. Shown crossed out for the rest of the visit. */
export type RemovedLine = { key: string; seller_id: string; mode: CartMode; name: string; reason: string };
export type PriceChange = { key: string; name: string; from: number; to: number };

export function getRemovedLines(sellerId?: string, mode?: CartMode): RemovedLine[] {
  return removedLines.filter((r) => (!sellerId || r.seller_id === sellerId) && (!mode || r.mode === mode));
}

export const REMOVED_OUT_OF_STOCK = "Out of stock — removed";
export const REMOVED_NOT_LISTED = "No longer listed — removed";
export const REMOVED_NOT_PREORDER = "Not open for pre-order — removed";
export const REMOVED_PACK_CHANGED = "Pack size changed — add it again";

const positive = (v: unknown) => (Number(v) > 0 ? Number(v) : null);

/**
 * Check one cart line against the live listing. Returns why it can't be ordered, or the
 * live price per base unit (same-day: option price; pre-order: top of the range).
 * Never falls back to another pack: a missing option or changed bundle drops the line.
 */
export function checkLine(item: CartItem, live: any, mode: CartMode): { reason: string } | { price: number; bundle: number } {
  if (!live || live.deleted_at) return { reason: REMOVED_NOT_LISTED };
  if (mode === "preorder") {
    if (!live.is_preorder_enabled) return { reason: REMOVED_NOT_PREORDER };
  } else if (!live.is_available || live.is_order_paused || (live.weight_avail != null && Number(live.weight_avail) < item.qty)) {
    return { reason: REMOVED_OUT_OF_STOCK };
  }
  const opts: any[] = Array.isArray(live.pricing_options) ? live.pricing_options : [];
  const want = item.pricing_option_id;
  // Lines saved as "default"/"" predate per-tier ids and always meant the first option.
  // Options without an id get `opt_<index>`, as the menu and server (canonicalPricingOptionsFromPayload) do.
  const opt = !want || want === "default" ? opts[0] : opts.find((o, i) => String(o?.id ?? `opt_${i}`) === want);
  if (!opt) return { reason: REMOVED_PACK_CHANGED };
  const bs = positive(opt.bundle_size) ?? 1;
  const packChanged = item.bundle_size != null
    ? Math.abs(Number(item.bundle_size) - bs) > 1e-9
    : Math.round(item.qty * 100) % Math.round(bs * 100) !== 0; // older lines: qty must still be whole packs
  if (packChanged) return { reason: REMOVED_PACK_CHANGED };
  const packPrice = mode === "preorder"
    ? positive(opt.preorder_price_max) ?? positive(opt.preorder_price_min) ?? positive(opt.price) ?? 0
    : positive(opt.price) ?? 0;
  return { price: packPrice / bs, bundle: bs };
}

const money = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN")}`;

/**
 * Re-check cart lines against the live catalog: drop what can't be ordered (kept in
 * getRemovedLines() for display) and reprice the rest to today's price.
 * With `mode`: only that cart. Without (a page that doesn't know the seller's mode): each
 * seller's mode comes from its hours; a closed seller's lines are left untouched.
 */
export async function validateCartLive(sellerId?: string, mode?: CartMode): Promise<{
  oosMessages: string[];
  priceChangedCount: number;
  priceMessages: string[];
  removed: RemovedLine[];
  priceChanges: PriceChange[];
  /** Mode each seller is in right now, when the server sent its hours. */
  sellerModes: Record<string, CartMode | "closed">;
}> {
  const out = {
    oosMessages: [] as string[],
    priceChangedCount: 0,
    priceMessages: [] as string[],
    removed: [] as RemovedLine[],
    priceChanges: [] as PriceChange[],
    sellerModes: {} as Record<string, CartMode | "closed">,
  };
  try {
    const all = Object.values(readAll()).filter((i) => (!sellerId || i.seller_id === sellerId) && (!mode || lineMode(i) === mode));
    if (all.length === 0) return out;

    const valRes = await fetch("/api/buyer/validate-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listing_ids: [...new Set(all.map((i) => i.listing_id))] }),
    });
    if (!valRes.ok) return out;
    const valData = await valRes.json();
    const listings: any[] = valData.listings || [];
    const now = Date.now();
    for (const l of listings) {
      if (l?.seller && l.seller_id && !(l.seller_id in out.sellerModes)) {
        out.sellerModes[l.seller_id] = classifyPlacementAtOrderTime(l.seller as SellerTimingInput, now);
      }
    }

    for (const item of all) {
      const itemMode = lineMode(item);
      // No mode given: only check a line in the mode its seller is in now. Unknown hours or
      // a closed shop: leave it (the seller page re-validates with its mode).
      if (!mode && out.sellerModes[item.seller_id] !== itemMode) continue;
      const key = lineKey(item);
      const live = listings.find((l) => l.id === item.listing_id);
      const r = checkLine(item, live, itemMode);
      if ("reason" in r) {
        removeItem(key);
        const line: RemovedLine = { key, seller_id: item.seller_id, mode: itemMode, name: item.name, reason: r.reason };
        removedLines = [...removedLines.filter((x) => x.key !== key), line];
        out.removed.push(line);
        out.oosMessages.push(`"${item.name}": ${r.reason}`);
      } else if (Math.abs(r.price - item.price) > 1e-6) {
        updateItemPrice(key, r.price);
        const bs = r.bundle;
        const change = { key, name: item.name, from: item.price * bs, to: r.price * bs };
        out.priceChanges.push(change);
        out.priceMessages.push(`"${item.name}" ${money(change.from)} → ${money(change.to)}`);
        out.priceChangedCount++;
      }
    }
  } catch (err) {
    console.error("Cart validation failed", err);
  }
  return out;
}

/** Mode a seller is in at `nowMs` (same rule the order API applies). */
export function placementAt(seller: SellerTimingInput, nowMs = Date.now()): CartMode | "closed" {
  return classifyPlacementAtOrderTime(seller, nowMs);
}

/**
 * Next moment the seller's mode can change: store open, close, pre-order start or cutoff, or IST
 * midnight (day-based rules). The seller page reloads then so menu, cart and prices switch.
 */
export function nextModeBoundaryMs(seller: SellerTimingInput, nowMs = Date.now()): number {
  const dayStart = Date.parse(istDayStartISO(nowMs));
  const mins = [0];
  for (const t of [seller.opens_at, seller.closes_at, seller.preorder_cutoff_time, seller.preorder_opens_at]) {
    if (!t) continue;
    const [h, m] = String(t).split(":").map(Number);
    if (Number.isFinite(h)) mins.push(h * 60 + (m || 0));
  }
  let next = Infinity;
  for (const d of [0, 1]) {
    for (const m of mins) {
      const at = dayStart + d * 86_400_000 + m * 60_000;
      if (at > nowMs && at < next) next = at;
    }
  }
  return next;
}

/** First moment after `nowMs` that the seller enters `mode` (scans ~10 days of boundaries), or null. */
export function nextPlacementStartMs(seller: SellerTimingInput, mode: CartMode, nowMs = Date.now()): number | null {
  let t = nowMs;
  for (let i = 0; i < 40; i++) {
    t = nextModeBoundaryMs(seller, t);
    if (placementAt(seller, t) === mode) return t;
  }
  return null;
}
