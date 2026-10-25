import { describe, it, expect } from "vitest";
import { dbFromForm, formFromDb, preorderMode, timingFormErrors, type TimingForm } from "../../src/lib/store-timing-form";
import { preorderScheduleLabel, sameDayScheduleLabel } from "../../src/lib/order-timing";
import { storePreorderLabel } from "../../src/lib/delivery-slots";

const ALL = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// Prod rows (read 22 Oct 2026) as Supabase returns them (time columns come back as HH:MM:SS).
const fishtokri = {
  open_days: ["tue", "wed", "thu", "fri", "sat", "sun"],
  opens_at: "08:00:00",
  closes_at: "18:00:00",
  accepts_preorder: true,
  preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat"],
  preorder_opens_at: null,
  preorder_cutoff_time: "03:00:00",
  delivery_days: null,
};
const nomadic = {
  open_days: [],
  opens_at: "08:00:00",
  closes_at: "22:00:00",
  accepts_preorder: true,
  preorder_days: ALL,
  preorder_opens_at: "13:00:00",
  preorder_cutoff_time: "02:00:00",
  delivery_days: ["tue", "sat"],
};
/** Same values, times as HH:MM (Postgres `time` stores 03:00 and 03:00:00 identically). */
const short = (row: Record<string, any>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 5) : v]));

describe("store timings form: existing sellers round-trip unchanged", () => {
  it("Fishtokri loads as same-day Tue–Sun 8–6, pre-orders Mon–Sat until 3 AM, next morning", () => {
    const f = formFromDb(fishtokri);
    expect(f).toMatchObject({
      sameDay: true, openDays: fishtokri.open_days, opensAt: "08:00", closesAt: "18:00",
      preorder: true, deliverOn: "next", preorderDays: fishtokri.preorder_days, stopAt: "03:00",
    });
    expect(preorderMode(f)).toBe("afterClose");
    expect(timingFormErrors(f)).toEqual({});
    expect(dbFromForm(f)).toEqual(short(fishtokri));
  });

  it("Nomadic loads as no same-day, delivers Tue & Sat, paused 2 AM–1 PM", () => {
    const f = formFromDb(nomadic);
    expect(f).toMatchObject({ sameDay: false, preorder: true, deliverOn: "days", deliveryDays: ["tue", "sat"], stopAt: "02:00", startAt: "13:00" });
    expect(preorderMode(f)).toBe("pause");
    expect(timingFormErrors(f)).toEqual({});
    // Hidden same-day hours (08:00–22:00) are kept too.
    expect(dbFromForm(f)).toEqual(short(nomadic));
  });

  it("preview lines match the store page", () => {
    expect(sameDayScheduleLabel(dbFromForm(formFromDb(fishtokri)))).toBe("Same day orders · Closed Mon · 8 AM–6 PM");
    expect(preorderScheduleLabel(dbFromForm(formFromDb(fishtokri)))).toBe("Pre-orders · Closed Sun · 6 PM–3 AM · delivered next day");
    expect(sameDayScheduleLabel(dbFromForm(formFromDb(nomadic)))).toBeNull();
    expect(preorderScheduleLabel(dbFromForm(formFromDb(nomadic)))).toBe(
      "Pre-orders open all week · delivered Tue & Sat"
    );
    expect(preorderScheduleLabel({ ...nomadic, accepts_preorder: false })).toBeNull();
  });

  it("delivery time on (prod slot settings): the store page's pre-order line", () => {
    const fishtokriSlots = { ...fishtokri, delivery_slots_enabled: true, delivery_slot_minutes: 120, preorder_delivery_start: "08:00:00", preorder_delivery_end: "18:00:00", preorder_days_ahead: 3 };
    const nomadicSlots = { ...nomadic, delivery_slots_enabled: true, delivery_slot_minutes: 120, preorder_delivery_start: "07:00:00", preorder_delivery_end: "13:00:00", preorder_days_ahead: 2 };
    expect(storePreorderLabel(fishtokriSlots)).toBe("Pre-order anytime · pick your day & time");
    expect(storePreorderLabel(nomadicSlots)).toBe("Pre-order anytime · delivered Tue & Sat · paused Tue & Sat 2 AM–1 PM");
    // Slots off: the schedule line, as before.
    expect(storePreorderLabel(fishtokri)).toBe("Pre-orders · Closed Sun · 6 PM–3 AM · delivered next day");
    expect(storePreorderLabel({ ...fishtokriSlots, accepts_preorder: false })).toBeNull();
  });
});

describe("store timings form → DB values", () => {
  const base = formFromDb(fishtokri);
  const f = (over: Partial<TimingForm>): TimingForm => ({ ...base, ...over });

  it("same-day on: pre-orders start at closing time (preorder_opens_at null), days from the chips", () => {
    const db = dbFromForm(f({ deliverOn: "days", deliveryDays: ["sat", "wed"] }));
    expect(db.preorder_opens_at).toBeNull();
    expect(db.preorder_days).toEqual(fishtokri.preorder_days);
    expect(db.delivery_days).toEqual(["wed", "sat"]);
  });

  it("no same-day + certain delivery days: open all week, pause start/end", () => {
    const db = dbFromForm(f({ sameDay: false, deliverOn: "days", deliveryDays: ["tue", "sat"], preorderDays: ["mon"], stopAt: "02:00", startAt: "13:00" }));
    expect(db).toMatchObject({ open_days: [], preorder_days: ALL, preorder_cutoff_time: "02:00", preorder_opens_at: "13:00", delivery_days: ["tue", "sat"] });
  });

  it("no same-day + next morning: every day from start to stop", () => {
    const db = dbFromForm(f({ sameDay: false, deliverOn: "next", stopAt: "02:00", startAt: "13:00" }));
    expect(db).toMatchObject({ open_days: [], preorder_days: ALL, preorder_cutoff_time: "02:00", preorder_opens_at: "13:00", delivery_days: null });
    expect(preorderScheduleLabel(db)).toBe("Pre-orders · Every day · 1 PM–2 AM · delivered next day");
  });

  it("legacy null open_days loads as every day", () => {
    expect(formFromDb({ ...fishtokri, open_days: null }).openDays).toEqual(ALL);
  });
});

describe("store timings form: friendly validation", () => {
  const base = formFromDb(fishtokri);
  const errs = (over: Partial<TimingForm>) => timingFormErrors({ ...base, ...over });

  it("needs same-day or pre-orders on", () => {
    expect(errs({ sameDay: false, preorder: false }).toggles).toMatch(/Turn on same-day orders or pre-orders/);
  });
  it("blocks a stop time equal to closing time (the old 6 PM–6 PM bug)", () => {
    expect(errs({ stopAt: "18:00" }).preorderTimes).toBe("Pick a stop time after you close at 6 PM (up to 12 hours later).");
    expect(errs({ stopAt: "17:00" }).preorderTimes).toBeDefined();
    expect(errs({ stopAt: "22:00" }).preorderTimes).toBeUndefined();
  });
  it("prod sellers with broken timings are blocked with a plain message", () => {
    // Bombay Sea Food: pre-orders stop at closing time (10 PM–10 PM).
    const bombay = { ...fishtokri, open_days: ALL, opens_at: "08:00:00", closes_at: "22:00:00", preorder_days: ALL, preorder_cutoff_time: "22:00:00" };
    expect(timingFormErrors(formFromDb(bombay))).toEqual({ preorderTimes: "Pick a stop time after you close at 10 PM (up to 12 hours later)." });
    // The fishy spot: open 1:00–1:01 AM, pre-orders until 11:59 PM (almost a day after closing).
    const fishy = { ...bombay, opens_at: "01:00:00", closes_at: "01:01:00", preorder_cutoff_time: "23:59:00" };
    expect(timingFormErrors(formFromDb(fishy))).toEqual({ preorderTimes: "Pick a stop time after you close at 1:01 AM (up to 12 hours later)." });
  });
  it("pre-orders off: their times are not checked", () => {
    expect(errs({ preorder: false, stopAt: "18:00" })).toEqual({});
  });
  it("blocks a pause that starts and ends at the same time", () => {
    const pause = { sameDay: false, deliverOn: "days" as const, deliveryDays: ["tue"] };
    expect(errs({ ...pause, stopAt: "13:00", startAt: "13:00" }).preorderTimes).toBe("The pause can't start and end at the same time.");
    expect(errs({ ...pause, stopAt: "14:00", startAt: "13:00" }).preorderTimes).toMatch(/end later the same day/);
  });
  it("delivery on certain days needs at least one day", () => {
    expect(errs({ deliverOn: "days", deliveryDays: [] }).deliveryDays).toBe("Pick at least one delivery day.");
  });
  it("same-day needs a day and different open/close times", () => {
    expect(errs({ openDays: [] }).openDays).toBeDefined();
    expect(errs({ opensAt: "18:00", closesAt: "18:00", stopAt: "22:00" }).hours).toBeDefined();
  });
});
