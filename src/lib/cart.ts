/**
 * Global cart — shared across all sellers.
 * Storage: single localStorage key `v2_cart_global` keyed by listing_id.
 * On checkout, items are grouped by seller_id and one order is placed per seller.
 *
 * Sync: when buyer is signed in, every mutation also POSTs/DELETEs to /api/buyer/cart.
 * On init for signed-in buyers, server cart is fetched and merged (server wins).
 */

export type CartItem = {
  listing_id: string;
  seller_id: string;
  seller_name: string;
  name: string;
  qty: number;
  qty_unit: string;
  price: number;
  added_at: number;
};

export type CartMap = Record<string, CartItem>;

export type SellerGroup = {
  seller_id: string;
  seller_name: string;
  items: CartItem[];
  subtotal: number;
  total_qty: number;
};

const KEY = "v2_cart_global";
const LEGACY_PREFIX = "v2_cart_"; // old per-seller keys

function getBuyerId(): string | null {
  try { return localStorage.getItem("zepto_buyer_id"); } catch { return null; }
}

export function getCart(): CartMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCart(c: CartMap) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
  // Notify listeners (e.g. CartBar in app shell)
  try { window.dispatchEvent(new CustomEvent("v2-cart-changed", { detail: { cart: c } })); } catch {}
}

/** Migrate any old per-seller carts (`v2_cart_<sellerId>`) into the global cart, then drop them. */
export function migrateLegacyCarts(opts: { sellerLookup?: (sellerId: string) => string }): void {
  try {
    const global = getCart();
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
      await fetch(`/api/buyer/cart?buyer_id=${buyerId}&listing_id=${payload.listing_id}`, { method: "DELETE" });
    } else if (action === "clear") {
      const sellerParam = payload?.seller_id ? `&seller_id=${payload.seller_id}` : "&clear=true";
      await fetch(`/api/buyer/cart?buyer_id=${buyerId}${sellerParam}`, { method: "DELETE" });
    }
  } catch {
    // Silent fail — local cart is source of truth, sync retries on next mutation
  }
}

export function addItem(item: Omit<CartItem, "qty" | "added_at"> & { qty?: number }): CartItem {
  let cart = getCart();

  // Single-seller cart: if the new item belongs to a different seller than what's
  // already in the cart, clear the old seller's items first. One seller per checkout.
  const existingSellers = new Set(Object.values(cart).map((i) => i.seller_id));
  if (existingSellers.size > 0 && !existingSellers.has(item.seller_id)) {
    // Wipe the entire cart — new seller replaces old.
    cart = {};
    syncMutation("clear");
    try { window.dispatchEvent(new CustomEvent("v2-cart-seller-switched", { detail: { newSellerId: item.seller_id } })); } catch {}
  }

  const existing = cart[item.listing_id];
  const next: CartItem = existing
    ? { ...existing, qty: existing.qty + (item.qty ?? 1) }
    : { ...item, qty: item.qty ?? 1, added_at: Date.now() };
  cart[item.listing_id] = next;
  saveCart(cart);
  syncMutation("upsert", {
    listing_id: next.listing_id,
    qty: next.qty,
    qty_unit: next.qty_unit,
    price_snapshot: next.price,
  });
  return next;
}

export function setQty(listingId: string, qty: number): void {
  const cart = getCart();
  if (!cart[listingId]) return;
  if (qty <= 0) {
    delete cart[listingId];
    saveCart(cart);
    syncMutation("remove", { listing_id: listingId });
    return;
  }
  cart[listingId].qty = qty;
  saveCart(cart);
  syncMutation("upsert", {
    listing_id: listingId,
    qty,
    qty_unit: cart[listingId].qty_unit,
    price_snapshot: cart[listingId].price,
  });
}

export function incQty(listingId: string): void {
  const cart = getCart();
  if (!cart[listingId]) return;
  setQty(listingId, cart[listingId].qty + 1);
}

export function decQty(listingId: string): void {
  const cart = getCart();
  if (!cart[listingId]) return;
  setQty(listingId, cart[listingId].qty - 1);
}

export function removeItem(listingId: string): void {
  const cart = getCart();
  if (!cart[listingId]) return;
  delete cart[listingId];
  saveCart(cart);
  syncMutation("remove", { listing_id: listingId });
}

export function clearCart(opts?: { sellerId?: string }): void {
  const cart = getCart();
  if (opts?.sellerId) {
    for (const lid of Object.keys(cart)) {
      if (cart[lid].seller_id === opts.sellerId) delete cart[lid];
    }
    saveCart(cart);
    syncMutation("clear", { seller_id: opts.sellerId });
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
        items: [],
        subtotal: 0,
        total_qty: 0,
      };
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

    const local = getCart();
    for (const it of items) {
      // Server wins
      local[it.listing_id] = {
        listing_id: it.listing_id,
        seller_id: it.seller_id,
        seller_name: it.seller_name || local[it.listing_id]?.seller_name || "",
        name: it.species_display || it.name || local[it.listing_id]?.name || "",
        qty: Number(it.qty) || 0,
        qty_unit: it.qty_unit || "kg",
        price: Number(it.price_snapshot) || 0,
        added_at: it.created_at ? new Date(it.created_at).getTime() : Date.now(),
      };
    }
    saveCart(local);
  } catch {}
}

/** Push local cart to server (called after sign-in to capture guest cart). */
export async function pushLocalToServer(): Promise<void> {
  const buyerId = getBuyerId();
  if (!buyerId) return;
  const cart = getCart();
  for (const item of Object.values(cart)) {
    await syncMutation("upsert", {
      listing_id: item.listing_id,
      qty: item.qty,
      qty_unit: item.qty_unit,
      price_snapshot: item.price,
    });
  }
}
