import { createClient } from "@supabase/supabase-js";
import type { PriceUnit } from "./species";
import {
  BUYER_TRACK_PAGE_SIZE,
  ordersDateCutoffIso,
  SELLER_ORDERS_PAGE_SIZE,
} from "./seller-orders-pagination";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
  expires_at: string;
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
  | "scheduled"
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
  scheduled_for?: string | null;
  schedule_slot_id?: string | null;
}

export interface Buyer {
  id: string;
  auth_id: string;
  phone: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  lat: number | null;
  lng: number | null;
  location_name: string | null;
  push_subscription: any | null;
  push_enabled: boolean;
  created_at: string;
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

export async function getActiveListings() {
  const { data, error } = await supabase
    .from("fish_listings")
    .select("*, seller:sellers(*)")
    .eq("is_available", true)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as FishListing[];
}

export async function getListingById(id: string) {
  const { data, error } = await supabase
    .from("fish_listings")
    .select("*, seller:sellers(*)")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as FishListing;
}

export async function getSellerById(id: string) {
  const { data, error } = await supabase
    .from("sellers")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as Seller;
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

export async function getSellerListings(sellerId: string) {
  const { data, error } = await supabase
    .from("fish_listings")
    .select("*")
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as FishListing[];
}

/** Fresh orders (not pre_order) for this seller’s listings, with server-side pagination. */
export async function getFreshOrdersForSellerPage(
  sellerId: string,
  options: {
    page: number;
    pageSize?: number;
    statusFilter: string;
    dateFilter: string;
  }
): Promise<{ orders: Order[]; total: number }> {
  const pageSize = options.pageSize ?? SELLER_ORDERS_PAGE_SIZE;
  const { data: listings } = await supabase
    .from("fish_listings")
    .select("id")
    .eq("seller_id", sellerId);

  const listingIds = listings?.map((l) => l.id) || [];
  if (listingIds.length === 0) return { orders: [], total: 0 };

  const cutoff = ordersDateCutoffIso(options.dateFilter);
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
  if (cutoff) {
    q = q.gte("created_at", cutoff);
  }

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
  }
): Promise<{ orders: Order[]; total: number }> {
  const pageSize = options.pageSize ?? SELLER_ORDERS_PAGE_SIZE;
  const { data: listings } = await supabase
    .from("fish_listings")
    .select("id")
    .eq("seller_id", sellerId);

  const listingIds = listings?.map((l) => l.id) || [];
  const orClause =
    listingIds.length > 0
      ? `listing_id.in.(${listingIds.join(",")}),listing_id.is.null`
      : "listing_id.is.null";

  const cutoff = ordersDateCutoffIso(options.dateFilter);
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

  if (cutoff) {
    q = q.gte("created_at", cutoff);
  }

  const { data, error, count } = await q.range(from, to);
  if (error) throw error;
  return { orders: (data || []) as Order[], total: count ?? 0 };
}

/** Tab badges: pending fresh + awaiting pre-orders + scheduled (not paginated). */
export async function getSellerOrderTabCounts(sellerId: string): Promise<{
  pendingFresh: number;
  preAwaiting: number;
  scheduled: number;
}> {
  const { data: listings } = await supabase
    .from("fish_listings")
    .select("id")
    .eq("seller_id", sellerId);

  const listingIds = listings?.map((l) => l.id) || [];

  let pendingFresh = 0;
  let scheduledCount = 0;
  if (listingIds.length > 0) {
    const { count, error } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .in("listing_id", listingIds)
      .eq("status", "pending");
    if (!error && count != null) pendingFresh = count;

    const { count: schedCount, error: schedErr } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .in("listing_id", listingIds)
      .eq("status", "scheduled");
    if (!schedErr && schedCount != null) scheduledCount = schedCount;
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
    scheduled: scheduledCount,
  };
}

/** Scheduled orders for seller, ordered by scheduled_for descending. */
export async function getScheduledOrdersForSeller(
  sellerId: string,
  options: { page: number; pageSize?: number }
): Promise<{ orders: Order[]; total: number }> {
  const pageSize = options.pageSize ?? SELLER_ORDERS_PAGE_SIZE;
  const { data: listings } = await supabase
    .from("fish_listings")
    .select("id")
    .eq("seller_id", sellerId);

  const listingIds = listings?.map((l) => l.id) || [];
  if (listingIds.length === 0) return { orders: [], total: 0 };

  const from = Math.max(0, (options.page - 1) * pageSize);
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("orders")
    .select("*", { count: "exact" })
    .in("listing_id", listingIds)
    .eq("status", "scheduled")
    .order("scheduled_for", { ascending: true })
    .range(from, to);

  if (error) throw error;
  return { orders: (data || []) as Order[], total: count ?? 0 };
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

export async function getSpeciesRanges() {
  const { data, error } = await supabase
    .from("species_ranges")
    .select("*")
    .order("species");

  if (error) throw error;
  return data as SpeciesRange[];
}

export async function getSellersForSpecies(species: string) {
  // Get sellers who currently have active listings for this species
  const { data: active, error: activeErr } = await supabase
    .from("fish_listings")
    .select("id, seller_id, price, price_unit, weight_avail, pickup_loc, seller:sellers(id, name, location_name, lat, lng, rating_avg, total_orders, has_delivery, delivery_rad, opens_at, closes_at)")
    .eq("species", species)
    .eq("is_available", true)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (activeErr) throw activeErr;

  // Also get sellers who have EVER listed this species but don't have an active listing
  const activeSids = new Set((active || []).map(l => l.seller_id));

  const { data: past } = await supabase
    .from("fish_listings")
    .select("seller_id, price, price_unit, seller:sellers(id, name, location_name, lat, lng, rating_avg, total_orders, has_delivery, delivery_rad, opens_at, closes_at)")
    .eq("species", species)
    .order("created_at", { ascending: false });

  const pastSellers = (past || [])
    .filter(l => !activeSids.has(l.seller_id))
    .reduce((acc, l) => {
      if (!acc.has(l.seller_id)) acc.set(l.seller_id, l);
      return acc;
    }, new Map());

  return {
    active: active || [],
    pastSellers: Array.from(pastSellers.values()),
  };
}

// --- Buyer Queries ---

export type BuyerOrderWithListing = Order & {
  listing?: FishListing & { seller?: Pick<Seller, "name" | "location_name" | "phone"> };
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
    .select("*, listing:fish_listings(*, seller:sellers(name, location_name, phone))", { count: "exact" })
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
