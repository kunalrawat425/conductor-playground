import { createClient } from "@supabase/supabase-js";
import type { PriceUnit } from "./species";
import {
  BUYER_TRACK_PAGE_SIZE,
  ordersDateRange,
  SELLER_ORDERS_PAGE_SIZE,
} from "./seller-orders-pagination";
import type { OrderDateRange } from "./seller-orders-pagination";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** One in-flight `fish_listings` id query per seller so parallel list + count calls share a single request. */
const listingIdsInflight = new Map<string, Promise<string[]>>();

async function getListingIdsForSeller(sellerId: string): Promise<string[]> {
  const existing = listingIdsInflight.get(sellerId);
  if (existing) return existing;
  const p = supabase
    .from("fish_listings")
    .select("id")
    .eq("seller_id", sellerId)
    .then(({ data, error }) => {
      if (error) throw error;
      return (data || []).map((l: { id: string }) => l.id);
    })
    .finally(() => {
      listingIdsInflight.delete(sellerId);
    });
  listingIdsInflight.set(sellerId, p);
  return p;
}

/** Coalesce concurrent identical reads (home catalog, species page, dashboard). */
let activeListingsInflight: Promise<FishListing[]> | null = null;
let allSellersInflight: Promise<Seller[]> | null = null;
let speciesRangesInflight: Promise<SpeciesRange[]> | null = null;
const sellerByIdInflight = new Map<string, Promise<Seller>>();
const sellerListingsInflight = new Map<string, Promise<FishListing[]>>();
const listingByIdInflight = new Map<string, Promise<FishListing>>();

// --- Types ---

export interface Seller {
  id: string;
  auth_id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  location: string;
  location_name: string;
  lat: number | null;
  lng: number | null;
  rating_avg: number;
  total_orders: number;
  has_delivery: boolean;
  delivery_rad: number | null;
  is_admin: boolean;
  flagged: boolean;
  push_subscription: any | null;
  push_enabled: boolean;
  opens_at: string;
  closes_at: string;
  accepts_preorder: boolean;
  created_at: string;
  /** Minimum line subtotal (₹); 0 = none */
  min_order_amount?: number;
  delivery_fee_enabled?: boolean;
  delivery_fee_amount?: number;
  /** Waive delivery fee when subtotal >= this (₹); null = no waiver */
  free_delivery_above?: number | null;
  /** false = seller not visible to buyers / cannot receive orders until activated */
  is_active?: boolean;
}

export interface FishListing {
  id: string;
  seller_id: string;
  species: string;
  price: number;
  price_unit: PriceUnit;
  weight_avail: number;
  photo_url: string | null;
  listed_date: string;
  is_available: boolean;
  pickup_loc: string;
  created_at: string;
  // joined
  seller?: Seller;
}

export type OrderStatus =
  | "pre_order"
  | "pending"
  | "confirmed"
  | "paid"
  | "picked_up"
  | "completed"
  | "declined"
  | "cancelled"
  | "refunded";

export type OrderType = "pickup" | "delivery";

export interface Order {
  id: string;
  listing_id: string | null;
  buyer_phone: string;
  buyer_addr: string | null;
  quantity: number;
  quantity_unit: PriceUnit;
  total_price: number;
  platform_fee: number;
  status: OrderStatus;
  order_type: OrderType;
  paid_amount: number | null;
  final_price: number | null;
  refund_amt: number | null;
  payment_type: string;
  buyer_id: string | null;
  species: string | null;
  created_at: string;
  delivery_fee?: number;
}

export interface Buyer {
  id: string;
  auth_id: string;
  phone: string;
  lat: number | null;
  lng: number | null;
  location_name: string | null;
  push_subscription: any | null;
  push_enabled: boolean;
  created_at: string;
  /** false = buyer cannot place orders */
  is_active?: boolean;
}

export interface SpeciesRange {
  id: string;
  species: string;
  price_unit: PriceUnit;
  min_price: number;
  max_price: number;
  updated_by: string | null;
  updated_at: string;
}

// --- Queries ---

export function getActiveListings(): Promise<FishListing[]> {
  if (activeListingsInflight) return activeListingsInflight;
  activeListingsInflight = supabase
    .from("fish_listings")
    .select("*, seller:sellers(*)")
    .eq("is_available", true)
    .order("created_at", { ascending: false })
    .then(({ data, error }) => {
      if (error) throw error;
      return ((data || []) as FishListing[]).filter(
        (l) => l.seller && (l.seller as Seller).is_active !== false
      );
    })
    .finally(() => {
      activeListingsInflight = null;
    });
  return activeListingsInflight;
}

/** All sellers (buyer home: listings + sellers without listings for pre-order). */
export function getAllSellers(): Promise<Seller[]> {
  if (allSellersInflight) return allSellersInflight;
  allSellersInflight = supabase
    .from("sellers")
    .select("*")
    .eq("is_active", true)
    .then(({ data, error }) => {
      if (error) throw error;
      return (data || []) as Seller[];
    })
    .finally(() => {
      allSellersInflight = null;
    });
  return allSellersInflight;
}

/** Home catalog: parallel active listings + all sellers, each deduped if called concurrently. */
export async function loadBuyerCatalog(): Promise<{ listings: FishListing[]; sellers: Seller[] }> {
  const [listings, sellers] = await Promise.all([
    getActiveListings().catch(() => [] as FishListing[]),
    getAllSellers().catch(() => [] as Seller[]),
  ]);
  return { listings, sellers };
}

export function getListingById(id: string): Promise<FishListing> {
  const hit = listingByIdInflight.get(id);
  if (hit) return hit;
  const p = supabase
    .from("fish_listings")
    .select("*, seller:sellers(*)")
    .eq("id", id)
    .single()
    .then(({ data, error }) => {
      if (error) throw error;
      return data as FishListing;
    })
    .finally(() => {
      listingByIdInflight.delete(id);
    });
  listingByIdInflight.set(id, p);
  return p;
}

export function getSellerById(id: string): Promise<Seller> {
  const hit = sellerByIdInflight.get(id);
  if (hit) return hit;
  const p = supabase
    .from("sellers")
    .select("*")
    .eq("id", id)
    .single()
    .then(({ data, error }) => {
      if (error) throw error;
      return data as Seller;
    })
    .finally(() => {
      sellerByIdInflight.delete(id);
    });
  sellerByIdInflight.set(id, p);
  return p;
}

export async function updateSellerProfile(
  id: string,
  updates: Partial<Seller>
) {
  const res = await fetch("/api/seller/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seller_id: id, updates }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update profile");
  return data.seller as Seller;
}

export function getSellerListings(sellerId: string): Promise<FishListing[]> {
  const hit = sellerListingsInflight.get(sellerId);
  if (hit) return hit;
  const p = supabase
    .from("fish_listings")
    .select("*")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false })
    .then(({ data, error }) => {
      if (error) throw error;
      return (data || []) as FishListing[];
    })
    .finally(() => {
      sellerListingsInflight.delete(sellerId);
    });
  sellerListingsInflight.set(sellerId, p);
  return p;
}

function applyOrderDateRange<T extends { gte: Function; lte: Function }>(
  q: T,
  range: OrderDateRange
): T {
  let out = q;
  if (range.startIso) out = out.gte("created_at", range.startIso) as T;
  if (range.endIso) out = out.lte("created_at", range.endIso) as T;
  return out;
}

/** Fresh orders (not pre_order) for this seller’s listings, with server-side pagination. */
export async function getFreshOrdersForSellerPage(
  sellerId: string,
  options: {
    page: number;
    pageSize?: number;
    statusFilter: string;
    dateFilter: string;
    customDateFrom?: string;
    customDateTo?: string;
  }
): Promise<{ orders: Order[]; total: number }> {
  const pageSize = options.pageSize ?? SELLER_ORDERS_PAGE_SIZE;
  const listingIds = await getListingIdsForSeller(sellerId);
  if (listingIds.length === 0) return { orders: [], total: 0 };

  const range = ordersDateRange(
    options.dateFilter,
    options.customDateFrom,
    options.customDateTo
  );
  const from = Math.max(0, (options.page - 1) * pageSize);
  const to = from + pageSize - 1;

  let q = supabase
    .from("orders")
    .select("*", { count: "exact" })
    .in("listing_id", listingIds)
    .neq("status", "pre_order")
    .order("created_at", { ascending: false });

  if (options.statusFilter !== "all") {
    q = q.eq("status", options.statusFilter);
  }
  q = applyOrderDateRange(q, range);

  const { data, error, count } = await q.range(from, to);
  if (error) throw error;
  return { orders: (data || []) as Order[], total: count ?? 0 };
}

/**
 * Pre-order queue: default “all” = status pre_order + listing OR null listing (same as legacy query).
 * Other statuses filter to that status with the same listing OR clause.
 */
export async function getPreOrdersForSellerPage(
  sellerId: string,
  options: {
    page: number;
    pageSize?: number;
    statusFilter: string;
    dateFilter: string;
    customDateFrom?: string;
    customDateTo?: string;
  }
): Promise<{ orders: Order[]; total: number }> {
  const pageSize = options.pageSize ?? SELLER_ORDERS_PAGE_SIZE;
  const listingIds = await getListingIdsForSeller(sellerId);
  const orClause =
    listingIds.length > 0
      ? `listing_id.in.(${listingIds.join(",")}),listing_id.is.null`
      : "listing_id.is.null";

  const range = ordersDateRange(
    options.dateFilter,
    options.customDateFrom,
    options.customDateTo
  );
  const from = Math.max(0, (options.page - 1) * pageSize);
  const to = from + pageSize - 1;

  let q = supabase
    .from("orders")
    .select("*", { count: "exact" })
    .or(orClause)
    .order("created_at", { ascending: false });

  if (options.statusFilter === "all") {
    q = q.eq("status", "pre_order");
  } else {
    q = q.eq("status", options.statusFilter);
  }

  q = applyOrderDateRange(q, range);

  const { data, error, count } = await q.range(from, to);
  if (error) throw error;
  return { orders: (data || []) as Order[], total: count ?? 0 };
}

/** Status counts for seller orders page stats cards (same date rules as lists). */
export async function getSellerOrdersDashboardStats(
  sellerId: string,
  options: {
    dateFilter: string;
    customDateFrom?: string;
    customDateTo?: string;
  }
): Promise<{
  fresh: {
    pending: number;
    confirmed: number;
    paid: number;
    picked_up: number;
    completed: number;
    declined: number;
    cancelled: number;
    total: number;
  };
  pre: {
    awaiting: number;
    confirmed: number;
    cancelled: number;
    refunded: number;
  };
}> {
  const range = ordersDateRange(
    options.dateFilter,
    options.customDateFrom,
    options.customDateTo
  );
  const listingIds = await getListingIdsForSeller(sellerId);
  const orClause =
    listingIds.length > 0
      ? `listing_id.in.(${listingIds.join(",")}),listing_id.is.null`
      : "listing_id.is.null";

  const emptyFresh = {
    pending: 0,
    confirmed: 0,
    paid: 0,
    picked_up: 0,
    completed: 0,
    declined: 0,
    cancelled: 0,
    total: 0,
  };

  async function countFresh(status?: string) {
    if (listingIds.length === 0) return 0;
    let q = supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .in("listing_id", listingIds)
      .neq("status", "pre_order");
    if (status) q = q.eq("status", status);
    q = applyOrderDateRange(q, range);
    const { count, error } = await q;
    return error ? 0 : count ?? 0;
  }

  async function countPre(status: string) {
    let q = supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", status)
      .or(orClause);
    q = applyOrderDateRange(q, range);
    const { count, error } = await q;
    return error ? 0 : count ?? 0;
  }

  if (listingIds.length === 0) {
    const [awaiting, pConf, pCan, pRef] = await Promise.all([
      countPre("pre_order"),
      countPre("confirmed"),
      countPre("cancelled"),
      countPre("refunded"),
    ]);
    return {
      fresh: emptyFresh,
      pre: {
        awaiting,
        confirmed: pConf,
        cancelled: pCan,
        refunded: pRef,
      },
    };
  }

  const [
    pending,
    confirmed,
    paid,
    picked_up,
    completed,
    declined,
    cancelled,
    total,
    awaiting,
    pConf,
    pCan,
    pRef,
  ] = await Promise.all([
    countFresh("pending"),
    countFresh("confirmed"),
    countFresh("paid"),
    countFresh("picked_up"),
    countFresh("completed"),
    countFresh("declined"),
    countFresh("cancelled"),
    countFresh(),
    countPre("pre_order"),
    countPre("confirmed"),
    countPre("cancelled"),
    countPre("refunded"),
  ]);

  return {
    fresh: {
      pending,
      confirmed,
      paid,
      picked_up,
      completed,
      declined,
      cancelled,
      total,
    },
    pre: {
      awaiting,
      confirmed: pConf,
      cancelled: pCan,
      refunded: pRef,
    },
  };
}

/** Tab badges: pending fresh + awaiting pre-orders (not paginated). */
export async function getSellerOrderTabCounts(sellerId: string): Promise<{
  pendingFresh: number;
  preAwaiting: number;
}> {
  const listingIds = await getListingIdsForSeller(sellerId);

  let pendingFresh = 0;
  if (listingIds.length > 0) {
    const { count, error } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .in("listing_id", listingIds)
      .eq("status", "pending");
    if (!error && count != null) pendingFresh = count;
  }

  const orClause =
    listingIds.length > 0
      ? `listing_id.in.(${listingIds.join(",")}),listing_id.is.null`
      : "listing_id.is.null";

  const { count: preCount, error: preErr } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("status", "pre_order")
    .or(orClause);

  return {
    pendingFresh,
    preAwaiting: preErr ? 0 : preCount ?? 0,
  };
}

export async function createListing(
  listing: Omit<FishListing, "id" | "created_at" | "seller">
) {
  const { seller_id, ...rest } = listing as any;
  const res = await fetch("/api/seller/listings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", seller_id, listing: rest }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to create listing");
  return data.listing as FishListing;
}

export async function updateListing(
  id: string,
  updates: Partial<FishListing>,
  sellerId?: string
) {
  // If sellerId provided, use API route (bypasses RLS)
  const sid = sellerId || (updates as any).seller_id;
  if (sid) {
    const res = await fetch("/api/seller/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", seller_id: sid, listing_id: id, updates }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to update listing");
    return data.listing as FishListing;
  }
  // Fallback to direct (for read-only contexts)
  const { data, error } = await supabase
    .from("fish_listings")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as FishListing;
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  finalPrice?: number,
  sellerId?: string
) {
  if (sellerId) {
    const res = await fetch("/api/seller/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seller_id: sellerId, order_id: orderId, status, final_price: finalPrice }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to update order");
    return data.order as Order;
  }
  // Fallback to direct
  const updates: Partial<Order> = { status };
  if (finalPrice !== undefined) {
    updates.final_price = finalPrice;
  }
  const { data, error } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", orderId)
    .select()
    .single();
  if (error) throw error;
  return data as Order;
}

export function getSpeciesRanges(): Promise<SpeciesRange[]> {
  if (speciesRangesInflight) return speciesRangesInflight;
  speciesRangesInflight = supabase
    .from("species_ranges")
    .select("*")
    .order("species")
    .then(({ data, error }) => {
      if (error) throw error;
      return (data || []) as SpeciesRange[];
    })
    .finally(() => {
      speciesRangesInflight = null;
    });
  return speciesRangesInflight;
}

const SPECIES_LISTING_SELLER_SELECT =
  "id, seller_id, species, price, price_unit, weight_avail, pickup_loc, is_available, created_at, seller:sellers(id, name, location_name, lat, lng, rating_avg, total_orders, has_delivery, delivery_rad, opens_at, closes_at, min_order_amount, delivery_fee_enabled, delivery_fee_amount, free_delivery_above, is_active)";

/** One query for species page: split active vs past sellers in memory (was two identical table scans). */
export async function getSellersForSpecies(species: string) {
  const { data: rows, error } = await supabase
    .from("fish_listings")
    .select(SPECIES_LISTING_SELLER_SELECT)
    .eq("species", species)
    .order("created_at", { ascending: false });

  if (error) throw error;
  const all = ((rows || []) as FishListing[]).filter(
    (l) => l.seller && (l.seller as Seller).is_active !== false
  );

  const active = all.filter((l) => l.is_available);
  const activeSids = new Set(active.map((l) => l.seller_id));

  const pastSellers: FishListing[] = [];
  const seenPast = new Set<string>();
  for (const l of all) {
    if (activeSids.has(l.seller_id)) continue;
    if (seenPast.has(l.seller_id)) continue;
    seenPast.add(l.seller_id);
    pastSellers.push(l);
  }

  return { active, pastSellers };
}

// --- Buyer Queries ---

export type BuyerOrderWithListing = Order & {
  listing?: FishListing & { seller?: Pick<Seller, "name" | "location_name"> };
};

/** Paginated buyer orders for `/track` (newest first). */
export async function getBuyerOrdersPage(
  buyerId: string,
  options: { page: number; pageSize?: number }
): Promise<{ orders: BuyerOrderWithListing[]; total: number }> {
  const pageSize = options.pageSize ?? BUYER_TRACK_PAGE_SIZE;
  const from = Math.max(0, (options.page - 1) * pageSize);
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("orders")
    .select("*, listing:fish_listings(*, seller:sellers(name, location_name))", { count: "exact" })
    .eq("buyer_id", buyerId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { orders: (data || []) as BuyerOrderWithListing[], total: count ?? 0 };
}

export async function updateBuyerPushSubscription(
  buyerId: string,
  subscription: any,
  enabled: boolean
) {
  const { error } = await supabase
    .from("buyers")
    .update({ push_subscription: subscription, push_enabled: enabled })
    .eq("id", buyerId);

  if (error) throw error;
}

export async function uploadFishPhoto(
  file: File,
  sellerId: string
): Promise<string> {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `listings/${sellerId}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from("fish-photos")
    .upload(path, file);

  if (error) throw error;

  const {
    data: { publicUrl },
  } = supabase.storage.from("fish-photos").getPublicUrl(path, {
    transform: { width: 400, format: "origin" },
  });

  return publicUrl;
}
