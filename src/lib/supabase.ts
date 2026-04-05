import { createClient } from "@supabase/supabase-js";
import type { PriceUnit } from "./species";

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

export async function getSellersWithLocation() {
  const { data, error } = await supabase
    .from("sellers")
    .select("id, name, location_name, lat, lng, has_delivery, delivery_rad, rating_avg")
    .not("lat", "is", null)
    .not("lng", "is", null);

  if (error) throw error;
  return data as Pick<
    Seller,
    "id" | "name" | "location_name" | "lat" | "lng" | "has_delivery" | "delivery_rad" | "rating_avg"
  >[];
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

export async function getSellerByAuthId(authId: string) {
  const { data, error } = await supabase
    .from("sellers")
    .select("*")
    .eq("auth_id", authId)
    .single();

  if (error) throw error;
  return data as Seller;
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

export async function getSellerOrders(sellerId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select("*, listing:fish_listings(*)")
    .eq("fish_listings.seller_id", sellerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as Order[];
}

export async function getOrdersForSeller(sellerId: string) {
  // Get all listing IDs for this seller, then get orders for those listings
  const { data: listings } = await supabase
    .from("fish_listings")
    .select("id")
    .eq("seller_id", sellerId);

  if (!listings || listings.length === 0) return [];

  const listingIds = listings.map((l) => l.id);
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .in("listing_id", listingIds)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as Order[];
}

export async function getPreOrdersForSeller(sellerId: string) {
  // Pre-orders may not have a listing_id yet (matched by species)
  // Get orders with status "pre_order" that have species matching seller's capabilities
  const { data: listings } = await supabase
    .from("fish_listings")
    .select("id")
    .eq("seller_id", sellerId);

  const listingIds = listings?.map((l) => l.id) || [];

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("status", "pre_order")
    .or(
      listingIds.length > 0
        ? `listing_id.in.(${listingIds.join(",")}),listing_id.is.null`
        : "listing_id.is.null"
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as Order[];
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

export async function getBuyerByAuthId(authId: string) {
  const { data, error } = await supabase
    .from("buyers")
    .select("*")
    .eq("auth_id", authId)
    .maybeSingle();

  if (error) throw error;
  return data as Buyer | null;
}

export async function getBuyerOrders(buyerId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select("*, listing:fish_listings(*, seller:sellers(name, location_name))")
    .eq("buyer_id", buyerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data as (Order & { listing?: FishListing & { seller?: Pick<Seller, "name" | "location_name"> } })[];
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
