/**
 * Single source of truth for seller orders list: Supabase range + dashboard UI slice.
 */
export const SELLER_ORDERS_PAGE_SIZE = 10;

/** Buyer `/track` list: same value used in Supabase `.range()` and pagination UI. */
export const BUYER_TRACK_PAGE_SIZE = 10;

/** Preset keys for seller orders date filter (lists + stats). */
export type SellerOrderDatePreset =
  | "all"
  | "today"
  | "7d"
  | "30d"
  | "1y"
  | "custom";

export interface OrderDateRange {
  /** Inclusive lower bound for `created_at`, or null for no lower bound. */
  startIso: string | null;
  /** Inclusive upper bound for `created_at`, or null for no upper bound. */
  endIso: string | null;
}

function localDayBounds(d: Date): { start: Date; end: Date } {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { start, end };
}

/** Parse `YYYY-MM-DD` as local calendar date; invalid → null. */
function parseLocalDateYmd(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return null;
  const [y, m, d] = s.trim().split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

/**
 * Date range for filtering `orders.created_at` (seller dashboard lists + stats).
 * Presets `7d`, `30d`, `1y` use a rolling window from now (no upper bound).
 * `today` uses local start/end of day.
 * `custom` uses inclusive local days when both from and to parse; either may extend range if only one is set.
 */
export function ordersDateRange(
  dateFilter: string,
  customFrom?: string | null,
  customTo?: string | null
): OrderDateRange {
  if (dateFilter === "all") {
    return { startIso: null, endIso: null };
  }

  const now = Date.now();
  const DAY_MS = 86400000;

  if (dateFilter === "today") {
    const { start, end } = localDayBounds(new Date());
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }
  if (dateFilter === "7d") {
    return { startIso: new Date(now - 7 * DAY_MS).toISOString(), endIso: null };
  }
  if (dateFilter === "30d") {
    return { startIso: new Date(now - 30 * DAY_MS).toISOString(), endIso: null };
  }
  if (dateFilter === "1y") {
    return { startIso: new Date(now - 365 * DAY_MS).toISOString(), endIso: null };
  }

  if (dateFilter === "custom") {
    const fromD = parseLocalDateYmd(customFrom);
    const toD = parseLocalDateYmd(customTo);
    if (fromD && toD) {
      const a = localDayBounds(fromD);
      const b = localDayBounds(toD);
      const lo = a.start <= b.start ? a.start : b.start;
      const hi = a.end >= b.end ? a.end : b.end;
      return { startIso: lo.toISOString(), endIso: hi.toISOString() };
    }
    if (fromD) {
      const { start } = localDayBounds(fromD);
      return { startIso: start.toISOString(), endIso: null };
    }
    if (toD) {
      const { end } = localDayBounds(toD);
      return { startIso: null, endIso: end.toISOString() };
    }
    return { startIso: null, endIso: null };
  }

  // Legacy / unknown → no filter
  return { startIso: null, endIso: null };
}
