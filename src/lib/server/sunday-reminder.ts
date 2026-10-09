/**
 * Saturday-evening "Sunday fish" reminder: which past buyers get a push, and what it says.
 * Pure (no DB), so the targeting rules are unit-tested:
 *  - past buyer = has a real (non-test) order that was paid at some point;
 *  - only active sellers that serve the buyer's location (within the seller's delivery radius);
 *  - "Pre-order for Sunday" only when the seller's real pre-order window is open tonight
 *    (same rules as checkout), otherwise "open tomorrow" when the seller opens on Sunday;
 *  - no prices (brand rule), one push per buyer, skipped if a promo went out recently.
 */
import { haversineKm } from "../order-pricing";
import { classifyPlacementAtOrderTime, type SellerTimingInput } from "../order-timing";
import { cleanSellerName, sellerHref } from "../seller-display";

export const PROMO_GAP_HOURS = 20;

export type ReminderSeller = SellerTimingInput & {
  id: string;
  name: string;
  lat: number | string | null;
  lng: number | string | null;
  delivery_rad?: number | string | null;
  has_preorder_listing: boolean;
  has_sameday_listing: boolean;
};

export type ReminderBuyer = {
  id: string;
  lat: number | string | null;
  lng: number | string | null;
  last_promo_push_sent_at?: string | null;
};

export type ReminderPush = { buyerId: string; title: string; body: string; path: string; sellerIds: string[] };

const STEP_MS = 15 * 60_000;

/** Last moment before IST midnight when this seller still takes a pre-order, or null if never tonight. */
export function preorderOpenUntil(seller: SellerTimingInput, nowMs: number): number | null {
  const istMidnight = Math.floor((nowMs + 5.5 * 3_600_000) / 86_400_000 + 1) * 86_400_000 - 5.5 * 3_600_000;
  let last: number | null = null;
  for (let t = nowMs; t < istMidnight; t += STEP_MS) {
    if (classifyPlacementAtOrderTime(seller, t) === "preorder") last = t;
  }
  return last;
}

/** "10 PM", "6:30 PM" from "22:00:00". */
export function timeLabel(hhmm: string | null | undefined): string {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  const hr = h % 12 || 12;
  return `${hr}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

function opensSunday(s: SellerTimingInput): boolean {
  const days = Array.isArray(s.open_days) ? s.open_days : [];
  return !days.length || days.includes("sun");
}

export function planSundayReminders(buyers: ReminderBuyer[], sellers: ReminderSeller[], nowMs: number): ReminderPush[] {
  const gapCutoff = nowMs - PROMO_GAP_HOURS * 3_600_000;
  // What each seller can offer for Sunday right now.
  const offers = sellers.flatMap((s) => {
    const name = cleanSellerName(s.name);
    if (s.has_preorder_listing && preorderOpenUntil(s, nowMs) != null) {
      const until = timeLabel(s.preorder_cutoff_time);
      return [{ s, name, line: `${name} is taking pre-orders for Sunday${until ? ` until ${until} tonight` : " tonight"}.` }];
    }
    if (s.has_sameday_listing && opensSunday(s)) {
      const from = timeLabel(s.opens_at);
      return [{ s, name, line: `${name} is open tomorrow${from ? ` from ${from}` : ""}.` }];
    }
    return [];
  });

  const out: ReminderPush[] = [];
  for (const b of buyers) {
    if (b.lat == null || b.lng == null) continue;
    if (b.last_promo_push_sent_at && new Date(b.last_promo_push_sent_at).getTime() > gapCutoff) continue;
    const near = offers.filter(({ s }) =>
      s.lat != null && s.lng != null &&
      haversineKm(Number(b.lat), Number(b.lng), Number(s.lat), Number(s.lng)) <= (Number(s.delivery_rad) || 5));
    if (!near.length) continue;
    const anyPreorder = near.some((o) => o.line.includes("pre-orders"));
    out.push({
      buyerId: b.id,
      title: anyPreorder ? "Pre-order your Sunday fish 🐟" : "Sunday fish from your local seller 🐟",
      body: near.slice(0, 2).map((o) => o.line).join(" "),
      path: near.length === 1 ? sellerHref(near[0].s.name, near[0].s.id) : "/shop",
      sellerIds: near.map((o) => o.s.id),
    });
  }
  return out;
}
