/**
 * Delivery slots (founder, 22 Oct 2026), for sellers who turn them on: at checkout the buyer
 * picks a day ("Today" = a same-day order, a later delivery day = a pre-order) and a time slot;
 * the seller can keep or change it when accepting / sending the order out.
 * Same-day slots run inside opens_at–closes_at; pre-order slots run in the seller's pre-order
 * delivery window on that day. Times are IST; slots are stored as UTC ISO timestamps
 * (orders.delivery_slot_start / _end). Slots off: order-timing.ts alone decides, as before.
 */
import {
  classifyPlacementAtOrderTime, isOvernightCutoff, isSellerEffectivelyOpen, pausesOnlyOnDeliveryDays, isTodayPreorderDay, preorderDeliveryDateIST, timeLabel, todayDayName,
  type SellerTimingInput,
} from "./order-timing";

export type SlotSeller = SellerTimingInput & {
  delivery_slots_enabled?: boolean | null;
  delivery_slot_minutes?: number | null;
  preorder_delivery_start?: string | null;
  preorder_delivery_end?: string | null;
  /** Pre-orders can be for the next 1–3 delivery days (slots on only). */
  preorder_days_ahead?: number | null;
};

export type DeliverySlot = { start: string; end: string };

/** Sellers columns the slot logic reads (timing + slot settings). */
export const SLOT_SELLER_COLUMNS =
  "opens_at, closes_at, accepts_preorder, open_days, preorder_days, preorder_cutoff_time, preorder_opens_at, delivery_days, delivery_slots_enabled, delivery_slot_minutes, preorder_delivery_start, preorder_delivery_end, preorder_days_ahead";

/** The earliest same-day slot starts at least this long after the order. */
export const SLOT_LEAD_MINUTES = 120;
export const PREORDER_DELIVERY_DEFAULT = { start: "07:00", end: "13:00" };

const IST_MS = 5.5 * 3600_000;
const DAY_MS = 86_400_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toMin(t: string | null | undefined, fallback: number): number {
  if (!t) return fallback;
  const [h, m] = String(t).split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : fallback;
}
const istDate = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const istAt = (date: string, min: number) => new Date(Date.parse(`${date}T00:00:00Z`) + min * 60_000 - IST_MS).toISOString();
const ist = (iso: string) => new Date(Date.parse(iso) + IST_MS);
const hhmm = (iso: string) => { const d = ist(iso); return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

export function slotMinutes(seller: SlotSeller): number {
  return Number(seller.delivery_slot_minutes) === 60 ? 60 : 120;
}

/** Back-to-back slots from `fromMin` to `toMin` (minutes after midnight IST of `date`; the last one may be shorter). */
function slotsBetween(date: string, fromMin: number, toMin: number, len: number): DeliverySlot[] {
  const out: DeliverySlot[] = [];
  for (let s = fromMin; s < toMin; s += len) out.push({ start: istAt(date, s), end: istAt(date, Math.min(s + len, toMin)) });
  return out;
}

/** Every slot the seller runs on an IST date (YYYY-MM-DD): open hours, or the pre-order delivery window. */
export function sellerSlotsOn(seller: SlotSeller, date: string, preorder: boolean): DeliverySlot[] {
  const len = slotMinutes(seller);
  if (preorder) {
    const { start, end } = PREORDER_DELIVERY_DEFAULT;
    return slotsBetween(date, toMin(seller.preorder_delivery_start, toMin(start, 0)), toMin(seller.preorder_delivery_end, toMin(end, 0)), len);
  }
  const open = toMin(seller.opens_at, 0);
  const close = toMin(seller.closes_at, 24 * 60);
  return slotsBetween(date, open, close <= open ? close + 24 * 60 : close, len);
}

/** Delivery mornings the seller runs: delivery_days when set, else the morning after each pre-order day. */
function isDeliveryDay(seller: SlotSeller, ms: number): boolean {
  const dd = seller.delivery_days;
  if (Array.isArray(dd) && dd.length) return dd.includes(todayDayName(new Date(ms)));
  return isTodayPreorderDay(seller, todayDayName(new Date(ms - DAY_MS)));
}

/**
 * Last moment to pre-order for delivery date D: the pre-order cutoff of the window that serves D,
 * i.e. D at the cutoff when it runs past midnight (Fishtokri 03:00, Nomadic 02:00), else the day
 * before at the cutoff (22:00). No cutoff = midnight before D.
 */
function preorderDeadlineMs(seller: SlotSeller, date: string): number {
  const midnight = Date.parse(`${date}T00:00:00+05:30`);
  const cut = toMin(seller.preorder_cutoff_time, 24 * 60);
  return (isOvernightCutoff(seller) ? midnight : midnight - DAY_MS) + cut * 60_000;
}

/**
 * IST dates a pre-order placed at `nowMs` can be delivered on (slots on): the seller's next
 * delivery days, up to preorder_days_ahead (1–3). Any time of day, also during shop hours; a day
 * whose cutoff has passed drops out (after 3 AM, this morning). Nomadic's delivery-morning pause
 * closes pre-orders completely.
 */
export function preorderDeliveryDates(seller: SlotSeller, nowMs = Date.now()): string[] {
  if (seller.accepts_preorder === false) return [];
  // Nomadic-style delivery-morning pause (Tue/Sat 2 AM–1 PM): pre-orders stay fully closed, as without slots.
  if (pausesOnlyOnDeliveryDays(seller) && classifyPlacementAtOrderTime(seller, nowMs) === "closed") return [];
  const ahead = Math.min(3, Math.max(1, Math.floor(Number(seller.preorder_days_ahead) || 1)));
  const out: string[] = [];
  const noon = Date.parse(`${istDate(nowMs)}T12:00:00+05:30`);
  for (let i = 0; out.length < ahead && i <= 14; i++) {
    const date = istDate(noon + i * DAY_MS);
    if (isDeliveryDay(seller, noon + i * DAY_MS) && nowMs < preorderDeadlineMs(seller, date)) out.push(date);
  }
  return out;
}

export type DeliveryDay = { date: string; kind: "same_day" | "preorder"; slots: DeliverySlot[] };

/**
 * The checkout's "When do you want it?" picker: Today (a same-day order, while the shop is open
 * and a slot at least `leadMin` away is left), then the pre-order delivery days. [] = slots off.
 */
export function deliveryDaysAt(seller: SlotSeller, nowMs = Date.now(), leadMin = SLOT_LEAD_MINUTES): DeliveryDay[] {
  if (!seller?.delivery_slots_enabled) return [];
  const earliest = nowMs + leadMin * 60_000;
  const later = (s: DeliverySlot) => Date.parse(s.start) >= earliest;
  const out: DeliveryDay[] = [];
  if (isSellerEffectivelyOpen(seller, nowMs)) {
    let date = istDate(nowMs);
    // Hours past midnight (e.g. 17:00–01:00) at 00:30: today's hours opened yesterday.
    const open = toMin(seller.opens_at, 0), close = toMin(seller.closes_at, 24 * 60);
    if (close <= open && Math.floor(((nowMs + IST_MS) % DAY_MS) / 60_000) < close) date = istDate(nowMs - DAY_MS);
    const slots = sellerSlotsOn(seller, date, false).filter(later);
    if (slots.length) out.push({ date, kind: "same_day", slots });
  }
  for (const date of preorderDeliveryDates(seller, nowMs)) {
    const slots = sellerSlotsOn(seller, date, true).filter(later);
    if (slots.length) out.push({ date, kind: "preorder", slots });
  }
  return out;
}

/** Every slot of deliveryDaysAt, flat. */
export function deliverySlotsAt(seller: SlotSeller, nowMs = Date.now(), leadMin = SLOT_LEAD_MINUTES): DeliverySlot[] {
  return deliveryDaysAt(seller, nowMs, leadMin).flatMap((d) => d.slots);
}

/** IST date (YYYY-MM-DD) of a timestamp, e.g. a slot start. */
export function slotDateIST(iso: string): string {
  return istDate(Date.parse(iso));
}

/**
 * IST date an order is delivered: its slot's date when it has one (a pre-order may be for a
 * later delivery day), else the pre-order delivery morning from its order time, else null.
 */
export function orderDeliveryDateIST(
  o: { delivery_slot_start?: string | null; created_at?: string | null; is_preorder?: boolean | null; placement_kind?: string | null },
  seller: SlotSeller | null | undefined
): string | null {
  if (o.delivery_slot_start) return slotDateIST(o.delivery_slot_start);
  const pre = o.is_preorder === true || o.placement_kind === "preorder";
  return pre && seller && o.created_at ? preorderDeliveryDateIST(seller, Date.parse(o.created_at)) : null;
}

/**
 * Order-create gate. Delivery orders of a seller with slots on must carry a slot the seller
 * offers right now (15 minutes of grace for the time spent in checkout); its day decides the
 * order kind (Today = same-day, a later day = pre-order). Anything else: no slot, kind by the clock.
 */
export function checkDeliverySlot(
  seller: SlotSeller | null | undefined,
  orderType: string,
  slotStart: unknown,
  nowMs = Date.now()
): { slot: DeliverySlot | null; kind?: DeliveryDay["kind"]; error?: string } {
  if (orderType !== "delivery" || !seller?.delivery_slots_enabled) return { slot: null };
  const t = Date.parse(String(slotStart || ""));
  if (!Number.isFinite(t)) return { slot: null, error: "Pick a delivery time slot." };
  for (const day of deliveryDaysAt(seller, nowMs, SLOT_LEAD_MINUTES - 15)) {
    const slot = day.slots.find((s) => Date.parse(s.start) === t);
    if (slot) return { slot, kind: day.kind };
  }
  return { slot: null, error: "That delivery slot is no longer available. Pick another time." };
}

/** Seller-set slot / "arriving by" window: a real range of at most 6 hours, not in the past. */
export function sellerSlotError(slot: { start?: unknown; end?: unknown } | null | undefined, nowMs = Date.now()): string | null {
  const s = Date.parse(String(slot?.start || "")), e = Date.parse(String(slot?.end || ""));
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return "Pick a valid delivery time.";
  if (e - s > 6 * 3600_000) return "A delivery slot can be at most 6 hours long.";
  if (e < nowMs - 3600_000 || s > nowMs + 8 * DAY_MS) return "Pick a delivery time from now on.";
  return null;
}

/** Profile save: slot settings (1 h or 2 h; pre-order window start before end). */
export function slotSettingsError(u: Record<string, any>): string | null {
  if (u.delivery_slot_minutes !== undefined && ![60, 120].includes(Number(u.delivery_slot_minutes))) return "Slot length must be 1 or 2 hours.";
  if (u.preorder_days_ahead !== undefined && ![1, 2, 3].includes(Number(u.preorder_days_ahead))) return "Pre-orders can be 1, 2 or 3 delivery days ahead.";
  const re = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
  for (const k of ["preorder_delivery_start", "preorder_delivery_end"]) {
    if (u[k] !== undefined && !re.test(String(u[k]))) return "Pre-order delivery times must be times (HH:MM).";
  }
  if (u.preorder_delivery_start && u.preorder_delivery_end && toMin(u.preorder_delivery_end, 0) <= toMin(u.preorder_delivery_start, 0)) {
    return "Pre-order deliveries must end after they start.";
  }
  return null;
}

/** "9–11 AM", "11 AM–1 PM". */
export function slotTimeLabel(start: string, end: string): string {
  const a = timeLabel(hhmm(start)), b = timeLabel(hhmm(end));
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
}

/** "Sat 25 Oct". */
export function slotDayLabel(iso: string): string {
  const d = ist(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Sat 25 Oct, 9–11 AM". */
export function slotLabel(start: string, end: string): string {
  return `${slotDayLabel(start)}, ${slotTimeLabel(start, end)}`;
}

/** "11 AM" — the end of the slot, i.e. "arriving by". */
export function arrivingByLabel(end: string): string {
  return timeLabel(hhmm(end));
}

/**
 * Evening-before seller push: pre-orders (one per cart) delivered on the IST day after `nowMs`
 * and the earliest slot among them. Orders: the seller's live pre-order rows.
 */
export function tomorrowPreorders(
  orders: { id: string; cart_id?: string | null; delivery_slot_start?: string | null; delivery_slot_end?: string | null; created_at?: string | null; is_preorder?: boolean | null; placement_kind?: string | null }[],
  seller: SlotSeller,
  nowMs = Date.now()
): { count: number; firstSlot: string | null } {
  const tomorrow = istDate(nowMs + DAY_MS);
  const due = orders.filter((o) => orderDeliveryDateIST(o, seller) === tomorrow);
  const first = due.filter((o) => o.delivery_slot_start && o.delivery_slot_end)
    .sort((a, b) => Date.parse(a.delivery_slot_start!) - Date.parse(b.delivery_slot_start!))[0];
  return {
    count: new Set(due.map((o) => o.cart_id || o.id)).size,
    firstSlot: first ? slotTimeLabel(first.delivery_slot_start!, first.delivery_slot_end!) : null,
  };
}

type SlotOrder = { status?: string | null; delivery_slot_start?: string | null; delivery_slot_end?: string | null };

/** What the buyer is told about an order's delivery time; null without a slot. */
export function orderSlotText(o: SlotOrder | null | undefined): { label: string; value: string } | null {
  if (!o?.delivery_slot_start || !o.delivery_slot_end) return null;
  return o.status === "out_for_delivery"
    ? { label: "Arriving by", value: arrivingByLabel(o.delivery_slot_end) }
    : { label: "Delivery slot", value: slotLabel(o.delivery_slot_start, o.delivery_slot_end) };
}
