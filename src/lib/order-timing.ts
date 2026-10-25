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
  /** Pre-order window opens at this time each pre-order day (null = closes_at / all day). */
  preorder_opens_at?: string | null;
  /** Weekdays pre-orders are delivered (null/[] = the next day). */
  delivery_days?: string[] | null;
  /** Delivery times on (lib/delivery-slots): labels name the real delivery day. */
  delivery_slots_enabled?: boolean | null;
};

export type PlacementKind = "same_day" | "preorder";

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function todayDayName(d = new Date()): string {
  // Extract day in IST — server runs UTC, so d.getDay() returns wrong day
  // between 18:30–23:59 UTC (= 00:00–05:30 IST next day).
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  return DAY_NAMES[new Date(istMs).getUTCDay()];
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
  // null/undefined (legacy rows) = every day. An explicit [] means the seller
  // unticked every same-day day: pre-order only, never same-day.
  if (!Array.isArray(seller.open_days)) return true;
  return seller.open_days.includes(day || todayDayName());
}

export function isTodayPreorderDay(seller: SellerTimingInput, day?: string): boolean {
  // The "Accept pre-orders" switch wins. The dashboard always saves
  // preorder_days, so with the switch off the server still took pre-orders
  // while the seller page showed the shop as closed.
  if (seller.accepts_preorder === false) return false;
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
// The day must come from the same clock as the time, or a caller passing nowMs
// got today's real weekday with the passed time-of-day.
const dayAt = (nowMs?: number) => todayDayName(nowMs == null ? undefined : new Date(nowMs));

export function isSellerEffectivelyOpen(seller: SellerTimingInput, nowMs?: number): boolean {
  return (
    isTodayOrderDay(seller, dayAt(nowMs)) &&
    isSellerOpenByClock(seller.opens_at ?? null, seller.closes_at ?? null, nowMs)
  );
}

/** True when IST time has passed the store's closes_at for today. */
export function isAfterCloseTimeIST(seller: SellerTimingInput, nowMs?: number): boolean {
  if (!seller.closes_at) return true; // no close time = treat as always past close
  const cur = minutesNowIST(nowMs);
  const [ch, cm] = seller.closes_at.split(":").map(Number);
  return cur >= ch * 60 + (cm || 0);
}

/** Seller still sells same-day today: an order day and not yet past closes_at (before opening counts). */
export function hasSameDayToday(seller: SellerTimingInput, nowMs?: number): boolean {
  return isSellerEffectivelyOpen(seller, nowMs) || (isTodayOrderDay(seller, dayAt(nowMs)) && !isAfterCloseTimeIST(seller, nowMs));
}

const DAY_MS = 86_400_000;

function toMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

/** "13:00" → "1 PM", "02:30" → "2:30 AM". */
export function timeLabel(hhmm: string | null | undefined): string {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  const hr = h % 12 || 12;
  return `${hr}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * Minute the pre-order window of `day` opens: preorder_opens_at when set; otherwise
 * closes_at on order days and 00:00 on days without same-day orders.
 */
function preorderStartMinutes(seller: SellerTimingInput, day: string): number {
  const opensAt = toMinutes(seller.preorder_opens_at);
  if (opensAt != null) return opensAt;
  return isTodayOrderDay(seller, day) ? toMinutes(seller.closes_at) ?? 0 : 0;
}

/**
 * Overnight cutoff: earlier than the window start (preorder_opens_at, else closes_at, else
 * 08:00), e.g. close 18:00 + cutoff 03:00. The window that opens on pre-order day D then runs
 * past midnight and ends at the cutoff on D+1. Same-day cutoffs (22:00) are unchanged.
 */
export function isOvernightCutoff(seller: SellerTimingInput): boolean {
  const cut = toMinutes(seller.preorder_cutoff_time);
  if (cut == null) return false;
  return cut < (toMinutes(seller.preorder_opens_at) ?? toMinutes(seller.closes_at) ?? 8 * 60);
}

/**
 * Delivery-day sellers with no same-day orders (e.g. The Nomadic Catch): pre-orders stay open
 * all day, and the off-window (cutoff → window start) applies only on delivery days.
 */
export function pausesOnlyOnDeliveryDays(seller: SellerTimingInput): boolean {
  return (
    Array.isArray(seller.open_days) && seller.open_days.length === 0 &&
    Array.isArray(seller.delivery_days) && seller.delivery_days.length > 0
  );
}

/** "paused Tue & Sat 2 AM–1 PM" for pausesOnlyOnDeliveryDays sellers, else null. */
export function preorderPauseLabel(seller: SellerTimingInput): string | null {
  if (!pausesOnlyOnDeliveryDays(seller) || !seller.preorder_cutoff_time || !seller.preorder_opens_at) return null;
  const days = DAY_LABELS.filter((_, i) => seller.delivery_days!.includes(DAY_NAMES[i]));
  return `paused ${days.join(" & ")} ${timeLabel(seller.preorder_cutoff_time)}–${timeLabel(seller.preorder_opens_at)}`;
}

/**
 * Which pre-order day's window is open at `nowMs`: 0 = today's, 1 = yesterday's (still
 * running past midnight, overnight cutoff), null = none.
 * Window of pre-order day D: from preorderStartMinutes until the cutoff on D (same-day
 * cutoff) or until the cutoff on D+1 (overnight cutoff).
 */
export function preorderWindowDaysBack(seller: SellerTimingInput, nowMs?: number): 0 | 1 | null {
  if (isSellerEffectivelyOpen(seller, nowMs)) return null;
  const at = nowMs ?? Date.now();
  const overnight = isOvernightCutoff(seller);
  const pastCutoff = isPastPreorderCutoffIST(seller.preorder_cutoff_time, at);
  if (overnight && !pastCutoff && isTodayPreorderDay(seller, dayAt(at - DAY_MS))) return 1;
  const day = dayAt(at);
  if (!isTodayPreorderDay(seller, day)) return null;
  // Delivery-day sellers (Nomadic): never paused. Founder, 25 Oct: after a delivery day's cutoff, take the
  // pre-order for the next delivery day instead of closing (Sun 10 AM → delivers Wed).
  if (pausesOnlyOnDeliveryDays(seller)) return 0;
  if (!overnight && pastCutoff) return null;
  if (minutesNowIST(at) < preorderStartMinutes(seller, day)) return null;
  return 0;
}

const istDate = (ms: number) => new Date(ms + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * IST date (YYYY-MM-DD) a pre-order placed at `nowMs` is delivered (its scheduled morning):
 * the first delivery_days day from the morning after its window's pre-order day
 * (null/[] delivery_days = that next morning). Tue 21:00 and Wed 01:30 (overnight cutoff)
 * both give Wed. Null outside a pre-order window.
 */
export function preorderDeliveryDateIST(seller: SellerTimingInput, nowMs = Date.now()): string | null {
  const back = preorderWindowDaysBack(seller, nowMs);
  if (back == null) return null;
  const nextMorning = nowMs + (1 - back) * DAY_MS;
  const days = Array.isArray(seller.delivery_days) && seller.delivery_days.length ? seller.delivery_days : null;
  for (let i = 0; i < 7; i++) {
    const ms = nextMorning + i * DAY_MS;
    if (!days || days.includes(dayAt(ms))) return istDate(ms);
  }
  return istDate(nextMorning);
}

/** "today" / "tomorrow" / "Tue" for an IST delivery date (YYYY-MM-DD), seen at `nowMs`. No "morning":
 *  delivery windows can run past it. */
export function deliveryMorningLabel(date: string, nowMs = Date.now()): string {
  if (date === istDate(nowMs)) return "today";
  if (date === istDate(nowMs + DAY_MS)) return "tomorrow";
  return DAY_LABELS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** Order-placed status line for pre-order emails, with the delivery day. */
export function preorderPlacedLabel(deliveryDate: string | null | undefined, nowMs = Date.now()): string {
  return `Pre-order placed — catch reserved for ${deliveryDate ? deliveryMorningLabel(deliveryDate, nowMs) : "tomorrow"}`;
}

/** Delivery day label for a pre-order placed at `nowMs`, or null outside a window. */
export function preorderDeliveryLabel(seller: SellerTimingInput, nowMs = Date.now()): string | null {
  const d = preorderDeliveryDateIST(seller, nowMs);
  return d ? deliveryMorningLabel(d, nowMs) : null;
}

/** Pre-order hours, e.g. "1 PM–2 AM" or "6 PM–3 AM"; "till 10 PM" when it opens at 00:00. */
export function preorderHoursLabel(seller: SellerTimingInput): string | null {
  if (!seller.preorder_cutoff_time) return null;
  const hasSameDay = !Array.isArray(seller.open_days) || seller.open_days.length > 0;
  const start = seller.preorder_opens_at || (hasSameDay ? seller.closes_at : null);
  const cut = timeLabel(seller.preorder_cutoff_time);
  return start ? `${timeLabel(start)}–${cut}` : `till ${cut}`;
}

/**
 * Short pre-order line for the seller page and lists (founder: small text, no "morning"):
 * inside a window "Pre-order · delivers Sat" / "· delivers tomorrow" when delivery times are on
 * or the seller delivers on set days, else "Pre-order · next day". Earlier on a pre-order day
 * "Pre-orders open at 1 PM"; pausesOnlyOnDeliveryDays sellers during the delivery-day pause
 * "Pre-orders reopen at 1 PM · delivering today". Else null.
 */
export function preorderStatusLabel(seller: SellerTimingInput, nowMs = Date.now()): string | null {
  const delivery = preorderDeliveryDateIST(seller, nowMs);
  const pauses = pausesOnlyOnDeliveryDays(seller);
  if (delivery) {
    const setDays = seller.delivery_slots_enabled || (Array.isArray(seller.delivery_days) && seller.delivery_days.length > 0);
    return setDays ? `Pre-order · delivers ${deliveryMorningLabel(delivery, nowMs)}` : "Pre-order · next day";
  }
  const start = toMinutes(seller.preorder_opens_at);
  if (start == null || isSellerEffectivelyOpen(seller, nowMs)) return null;
  if (isTodayPreorderDay(seller, dayAt(nowMs)) && minutesNowIST(nowMs) < start) {
    // For `pauses` sellers only a delivery day gets here: today's catch is out for delivery.
    return pauses
      ? `Pre-orders reopen at ${timeLabel(seller.preorder_opens_at)} · delivering today`
      : `Pre-orders open at ${timeLabel(seller.preorder_opens_at)}`;
  }
  return null;
}

const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const dayLabel = (d: string) => DAY_LABELS[DAY_NAMES.indexOf(d as (typeof DAY_NAMES)[number])] || d;

/** "Every day", "Closed Mon" or "Tue, Sat" (whichever list is shorter). */
export function daysLabel(days: string[]): string {
  if (!days.length) return "No same-day orders";
  if (days.length === 7) return "Every day";
  const closed = WEEK.filter((d) => !days.includes(d));
  return closed.length < days.length ? `Closed ${closed.map(dayLabel).join(", ")}` : days.map(dayLabel).join(", ");
}

/** Store-page schedule line: "Same day orders · Closed Mon · 8 AM–6 PM"; null with no same-day days. */
export function sameDayScheduleLabel(seller: SellerTimingInput): string | null {
  const days = Array.isArray(seller.open_days) ? seller.open_days : WEEK;
  if (!days.length) return null;
  const hours = seller.opens_at && seller.closes_at ? ` · ${timeLabel(seller.opens_at)}–${timeLabel(seller.closes_at)}` : "";
  return `Same day orders · ${daysLabel(days)}${hours}`;
}

/**
 * Store-page pre-order line: "Pre-orders · Closed Sun · 6 PM–3 AM · delivered next day", or
 * "Pre-orders open all week · paused Tue & Sat 2 AM–1 PM · delivered Tue & Sat". Null when off.
 */
export function preorderScheduleLabel(seller: SellerTimingInput): string | null {
  const days = Array.isArray(seller.preorder_days) ? seller.preorder_days : [];
  if (!seller.accepts_preorder || !days.length) return null;
  const dd = Array.isArray(seller.delivery_days) ? seller.delivery_days : [];
  const delivered = dd.length ? `delivered ${WEEK.filter((d) => dd.includes(d)).map(dayLabel).join(" & ")}` : "delivered next day";
  if (pausesOnlyOnDeliveryDays(seller)) return `Pre-orders open ${days.length === 7 ? "all week" : daysLabel(days)} · ${delivered}`;
  const sameDays = daysLabel(Array.isArray(seller.open_days) ? seller.open_days : WEEK) === daysLabel(days);
  const hours = preorderHoursLabel(seller);
  return `Pre-orders · ${sameDays ? "Same days" : daysLabel(days)}${hours ? ` · ${hours}` : ""} · ${delivered}`;
}

/** Preorder window open now (see preorderWindowDaysBack). */
export function isPreorderShoppingWindow(seller: SellerTimingInput, nowMs?: number): boolean {
  return preorderWindowDaysBack(seller, nowMs) != null;
}

export function classifyPlacementAtOrderTime(
  seller: SellerTimingInput,
  nowMs?: number
): PlacementKind | "closed" {
  if (isSellerEffectivelyOpen(seller, nowMs)) return "same_day";
  if (isPreorderShoppingWindow(seller, nowMs)) return "preorder";
  return "closed";
}

export function closedSellerMessage(seller: SellerTimingInput, nowMs?: number): string {
  const at = nowMs ?? Date.now();
  const day = dayAt(at);
  const t = seller.preorder_cutoff_time || "cutoff";
  const beforeClose = isTodayOrderDay(seller, day) && !isAfterCloseTimeIST(seller, at);
  const opens = beforeClose && seller.opens_at ? ` Opens at ${seller.opens_at}.` : "";
  const preStart = toMinutes(seller.preorder_opens_at);
  const later =
    preStart != null && isTodayPreorderDay(seller, day) && minutesNowIST(at) < preStart
      ? ` Pre-orders open at ${timeLabel(seller.preorder_opens_at)}.`
      : "";
  // Delivery-day pause (e.g. Nomadic, Tue 2 AM–1 PM): not a cutoff, pre-orders come back today.
  if (later && pausesOnlyOnDeliveryDays(seller) && seller.delivery_days!.includes(day)) {
    return `Pre-orders reopen at ${timeLabel(seller.preorder_opens_at)} today.`;
  }
  const overnight = isOvernightCutoff(seller);
  const pastCutoff = isPastPreorderCutoffIST(seller.preorder_cutoff_time, at);
  // Overnight cutoff: last night's window just ended (e.g. 03:30 after a 03:00 cutoff).
  if (overnight && pastCutoff && isTodayPreorderDay(seller, dayAt(at - DAY_MS))) {
    return `Pre-order cutoff (${t} IST) has passed.${opens}${later}`;
  }
  if (!isTodayOrderDay(seller, day) && !isTodayPreorderDay(seller, day)) {
    return "This seller is not open today and does not accept pre-orders.";
  }
  if (later) return `Not taking orders right now.${opens}${later}`;
  if (!overnight && pastCutoff) {
    return `Pre-order cutoff (${t} IST) has passed. Try again tomorrow.`;
  }
  // Before store closes on an order day — same-day window not yet open, preorder not yet open
  if (beforeClose) {
    return `Store not yet open for orders.${opens}`;
  }
  return "This seller is closed now and is not accepting pre-orders.";
}

/**
 * Start of the current IST day, as an ISO timestamp.
 *
 * BUG-45: callers used `new Date(); d.setHours(0,0,0,0)`, which zeroes the time
 * in the SERVER's zone. On Vercel that is UTC, so the "day" ran 05:30 IST to
 * 05:30 IST and every per-day limit reset mid-morning instead of at midnight.
 * A buyer capped at 5 kg/day could take 5 kg at 02:00 IST and another 5 kg at
 * 06:00 IST — 10 kg inside one IST day.
 */
export function istDayStartISO(nowMs = Date.now()): string {
  const ist = new Date(nowMs + 5.5 * 60 * 60 * 1000);
  const midnightIstAsUtcMs = Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate()
  );
  return new Date(midnightIstAsUtcMs - 5.5 * 60 * 60 * 1000).toISOString();
}
