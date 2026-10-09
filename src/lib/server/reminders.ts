/**
 * Pure selection logic for buyer reminders (unpaid orders, abandoned carts).
 *
 * The reminder job runs hourly and only picks items whose last activity falls in the
 * [now-120min, now-60min) window, so each order/cart is reminded at most once without
 * a "reminder_sent" column. A skipped run means that hour's items get no reminder.
 */
export const REMIND_AFTER_MS = 60 * 60 * 1000;
export const REMIND_WINDOW_MS = 60 * 60 * 1000;

export function inReminderWindow(ts: string | number | Date, now: number): boolean {
  const t = new Date(ts).getTime();
  return Number.isFinite(t) && t <= now - REMIND_AFTER_MS && t > now - REMIND_AFTER_MS - REMIND_WINDOW_MS;
}

/** Hourly runs use fixed, non-overlapping windows: late or repeated runs in the same hour select nothing new. */
export function windowNow(ms: number): number {
  return Math.floor(ms / 3_600_000) * 3_600_000;
}

/** No pushes at night: only 07:00–20:59 IST. */
export function inSendingHours(ms: number): boolean {
  const istHour = new Date(ms + 5.5 * 3_600_000).getUTCHours();
  return istHour >= 7 && istHour < 21;
}

export interface PendingOrderRow {
  id: string;
  buyer_id: string | null;
  species: string | null;
  created_at: string;
  razorpay_payment_id?: string | null;
  payment_verified_at?: string | null;
  payment_screenshot_urls?: string[] | null;
}

/** Any sign the buyer already paid (Razorpay capture, verified, or UPI proof uploaded awaiting check). */
export function hasPaymentEvidence(r: PendingOrderRow): boolean {
  return !!r.razorpay_payment_id || !!r.payment_verified_at || (Array.isArray(r.payment_screenshot_urls) && r.payment_screenshot_urls.length > 0);
}

/** One reminder per buyer checkout: a cart creates one row per line, placed in the same minute. */
export function unpaidOrdersToRemind(rows: PendingOrderRow[], now: number): PendingOrderRow[] {
  const seen = new Set<string>();
  const out: PendingOrderRow[] = [];
  for (const r of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!r.buyer_id || hasPaymentEvidence(r) || !inReminderWindow(r.created_at, now)) continue;
    const key = `${r.buyer_id}:${r.created_at.slice(0, 16)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export interface CartRow { buyer_id: string; created_at: string; updated_at: string | null }

/**
 * Buyers whose cart went quiet 1–2h ago and who have not placed an order since.
 * `ordersSince[buyer_id]` = latest order created_at for that buyer (if any).
 */
export function abandonedCartBuyers(rows: CartRow[], ordersSince: Record<string, string>, now: number): string[] {
  const last = new Map<string, number>();
  for (const r of rows) {
    const t = Math.max(new Date(r.created_at).getTime(), r.updated_at ? new Date(r.updated_at).getTime() : 0);
    last.set(r.buyer_id, Math.max(last.get(r.buyer_id) ?? 0, t));
  }
  return [...last.entries()]
    .filter(([buyer, t]) => inReminderWindow(t, now) && !(ordersSince[buyer] && new Date(ordersSince[buyer]).getTime() >= t))
    .map(([buyer]) => buyer);
}
