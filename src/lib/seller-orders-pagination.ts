/**
 * Single source of truth for seller orders list: Supabase range + dashboard UI slice.
 */
export const SELLER_ORDERS_PAGE_SIZE = 10;

/** Buyer `/track` list: same value used in Supabase `.range()` and pagination UI. */
export const BUYER_TRACK_PAGE_SIZE = 10;

export function ordersDateCutoffIso(dateFilter: string): string | null {
  if (dateFilter === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (dateFilter === "7d") return new Date(Date.now() - 7 * 86400000).toISOString();
  if (dateFilter === "30d") return new Date(Date.now() - 30 * 86400000).toISOString();
  return null;
}
