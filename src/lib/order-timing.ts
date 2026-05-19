/**
 * Order vs pre-order is determined only by seller shopping hours and order placement time (IST).
 * Listing flags and pickup scheduling do not change placement kind.
 */

export type SellerTimingInput = {
  opens_at?: string | null;
  closes_at?: string | null;
  accepts_preorder?: boolean | null;
  open_days?: string[] | null;
  preorder_days?: string[] | null;
  preorder_cutoff_time?: string | null;
};

export type PlacementKind = "same_day" | "preorder";

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function todayDayName(d = new Date()): string {
  return DAY_NAMES[d.getDay()];
}

/** Minutes since midnight in IST (UTC+5:30). */
export function minutesNowIST(nowMs = Date.now()): number {
  const nowISTMs = nowMs + 5.5 * 60 * 60 * 1000;
  const nowIST = new Date(nowISTMs);
  return nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
}

export function isSellerOpenByClock(
  opensAt: string | null | undefined,
  closesAt: string | null | undefined,
  nowMs?: number
): boolean {
  if (!opensAt || !closesAt) return true;
  const current = minutesNowIST(nowMs);
  const [oh, om] = opensAt.split(":").map(Number);
  const [ch, cm] = closesAt.split(":").map(Number);
  const open = oh * 60 + (om || 0);
  const close = ch * 60 + (cm || 0);
  if (close > open) return current >= open && current < close;
  return current >= open || current < close;
}

export function isTodayOrderDay(seller: SellerTimingInput, day?: string): boolean {
  const d = day || todayDayName();
  const openDays = Array.isArray(seller.open_days) ? seller.open_days : [];
  return !openDays.length || openDays.includes(d);
}

export function isTodayPreorderDay(seller: SellerTimingInput, day?: string): boolean {
  const d = day || todayDayName();
  const preorderDays = Array.isArray(seller.preorder_days) ? seller.preorder_days : [];
  if (preorderDays.length > 0) return preorderDays.includes(d);
  return !!seller.accepts_preorder;
}

export function isPastPreorderCutoffIST(
  cutoffTime: string | null | undefined,
  nowMs?: number
): boolean {
  if (!cutoffTime) return false;
  const nowMinutes = minutesNowIST(nowMs);
  const [cutHour, cutMin] = cutoffTime.split(":").map(Number);
  const cutoffMinutes = cutHour * 60 + cutMin;
  return nowMinutes >= cutoffMinutes;
}

/** Seller is open for same-day orders (order day + clock window). */
export function isSellerEffectivelyOpen(seller: SellerTimingInput, nowMs?: number): boolean {
  return (
    isTodayOrderDay(seller) &&
    isSellerOpenByClock(seller.opens_at ?? null, seller.closes_at ?? null, nowMs)
  );
}

/** Closed now but still accepting pre-orders for next catch (day + before cutoff). */
export function isPreorderShoppingWindow(seller: SellerTimingInput, nowMs?: number): boolean {
  if (isSellerEffectivelyOpen(seller, nowMs)) return false;
  if (!isTodayPreorderDay(seller)) return false;
  if (isPastPreorderCutoffIST(seller.preorder_cutoff_time, nowMs)) return false;
  return true;
}

export function classifyPlacementAtOrderTime(
  seller: SellerTimingInput,
  nowMs?: number
): PlacementKind | "closed" {
  if (isSellerEffectivelyOpen(seller, nowMs)) return "same_day";
  if (isPreorderShoppingWindow(seller, nowMs)) return "preorder";
  return "closed";
}

export function closedSellerMessage(seller: SellerTimingInput): string {
  const dayOff = !isTodayOrderDay(seller);
  if (dayOff && !isTodayPreorderDay(seller)) {
    return "This seller is not open today and does not accept pre-orders.";
  }
  if (isPastPreorderCutoffIST(seller.preorder_cutoff_time)) {
    const t = seller.preorder_cutoff_time || "cutoff";
    return `Pre-order cutoff (${t} IST) has passed. Try again tomorrow.`;
  }
  return "This seller is closed now and is not accepting pre-orders.";
}
