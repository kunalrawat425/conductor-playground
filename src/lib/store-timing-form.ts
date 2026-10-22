/**
 * Seller "Store timings" form <-> sellers columns. Pure, so the mapping is unit-tested.
 * The rules themselves live in order-timing.ts.
 */
import { timeLabel, type SellerTimingInput } from "./order-timing";

export const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export type TimingDb = {
  open_days: string[];
  opens_at: string;
  closes_at: string;
  accepts_preorder: boolean;
  preorder_days: string[];
  preorder_opens_at: string | null;
  preorder_cutoff_time: string;
  delivery_days: string[] | null;
};

export type TimingForm = {
  sameDay: boolean;
  openDays: string[];
  opensAt: string;
  closesAt: string;
  preorder: boolean;
  /** "next" = the next morning (delivery_days null), "days" = only on deliveryDays. */
  deliverOn: "next" | "days";
  deliveryDays: string[];
  preorderDays: string[];
  /** preorder_cutoff_time: "until" (after close), pause start, or window end. */
  stopAt: string;
  /** preorder_opens_at when there are no same-day orders: pause end or window start. */
  startAt: string;
};

/**
 * Which "When can buyers pre-order?" sentence applies:
 * afterClose = "From closing time until …", pause = "Open all week, paused on delivery days …",
 * window = "Every day from … to …".
 */
export type PreorderMode = "afterClose" | "pause" | "window";
export function preorderMode(f: Pick<TimingForm, "sameDay" | "deliverOn">): PreorderMode {
  if (f.sameDay) return "afterClose";
  return f.deliverOn === "days" ? "pause" : "window";
}

const hhmm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : "");
const sortDays = (days: string[]) => WEEK.filter((d) => days.includes(d));
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

export function formFromDb(s: SellerTimingInput): TimingForm {
  const openDays = Array.isArray(s.open_days) ? s.open_days : WEEK; // null = every day (legacy)
  const preorderDays = Array.isArray(s.preorder_days) && s.preorder_days.length ? s.preorder_days : WEEK;
  const deliveryDays = Array.isArray(s.delivery_days) ? s.delivery_days : [];
  return {
    sameDay: openDays.length > 0,
    openDays: openDays.length ? sortDays(openDays) : WEEK,
    opensAt: hhmm(s.opens_at) || "05:00",
    closesAt: hhmm(s.closes_at) || "11:00",
    preorder: !!s.accepts_preorder,
    deliverOn: deliveryDays.length ? "days" : "next",
    deliveryDays: sortDays(deliveryDays),
    preorderDays: sortDays(preorderDays),
    stopAt: hhmm(s.preorder_cutoff_time) || "22:00",
    startAt: hhmm(s.preorder_opens_at) || "13:00",
  };
}

export function dbFromForm(f: TimingForm): TimingDb {
  const mode = preorderMode(f);
  return {
    open_days: f.sameDay ? sortDays(f.openDays) : [],
    // Kept as-is when same-day is off, so turning it back on restores the old hours.
    opens_at: f.opensAt,
    closes_at: f.closesAt,
    accepts_preorder: f.preorder,
    // Pause and window setups are "open all week" / "every day"; only after-close picks days.
    preorder_days: mode === "afterClose" ? sortDays(f.preorderDays) : [...WEEK],
    preorder_opens_at: mode === "afterClose" ? null : f.startAt,
    preorder_cutoff_time: f.stopAt,
    delivery_days: f.deliverOn === "days" ? sortDays(f.deliveryDays) : null,
  };
}

export type TimingField = "toggles" | "openDays" | "hours" | "deliveryDays" | "preorderDays" | "preorderTimes";

/** Friendly problems with the form, keyed by the field to show them under. Empty = OK to save. */
export function timingFormErrors(f: TimingForm): Partial<Record<TimingField, string>> {
  const e: Partial<Record<TimingField, string>> = {};
  if (!f.sameDay && !f.preorder) e.toggles = "Turn on same-day orders or pre-orders, so buyers can order from you.";
  if (f.sameDay) {
    if (!f.openDays.length) e.openDays = "Pick at least one day for same-day orders.";
    if (f.opensAt === f.closesAt) e.hours = "Opening and closing time can't be the same.";
  }
  if (!f.preorder) return e;
  if (f.deliverOn === "days" && !f.deliveryDays.length) e.deliveryDays = "Pick at least one delivery day.";
  const mode = preorderMode(f);
  if (mode === "afterClose" && !f.preorderDays.length) e.preorderDays = "Pick at least one day for pre-orders.";
  if (mode === "afterClose") {
    // Minutes from closing to the stop time; 0 was the old "6 PM–6 PM" bug.
    const gap = (toMin(f.stopAt) - toMin(f.closesAt) + 1440) % 1440;
    if (gap === 0 || gap > 12 * 60) {
      e.preorderTimes = `Pick a stop time after your closing time (${timeLabel(f.closesAt)}).`;
    }
  } else if (f.stopAt === f.startAt) {
    e.preorderTimes = mode === "pause" ? "The pause can't start and end at the same time." : "Start and stop times can't be the same.";
  } else if (mode === "pause" && toMin(f.stopAt) > toMin(f.startAt)) {
    e.preorderTimes = "The pause has to end later the same day (e.g. 2 AM to 1 PM).";
  }
  return e;
}
