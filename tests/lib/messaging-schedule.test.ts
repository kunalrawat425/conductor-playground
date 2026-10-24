import { describe, expect, it } from "vitest";
import { decide, eveningMin, morningMin, offerAt, type BuyerState, type MsgSeller, type SentLog } from "../../src/lib/messaging/schedule";

// Live prod settings (24 Oct 2026).
const FISHTOKRI: MsgSeller = {
  id: "ft", name: "Fishtokri", slug: "fishtokri", lat: 19.1906444, lng: 72.9791824, delivery_rad: 7,
  opens_at: "08:00:00", closes_at: "18:00:00", open_days: ["tue", "wed", "thu", "fri", "sat", "sun"], accepts_preorder: true,
  preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat"], preorder_opens_at: null, preorder_cutoff_time: "03:00:00", delivery_days: null,
  delivery_slots_enabled: true, delivery_slot_minutes: 120, preorder_delivery_start: "08:00:00", preorder_delivery_end: "18:00:00", preorder_days_ahead: 3,
} as MsgSeller;
const NOMADIC: MsgSeller = {
  id: "nm", name: "The Nomadic Catch", slug: "the-nomadic-catch", lat: 19.2186389, lng: 72.9557714, delivery_rad: 6,
  opens_at: "08:00:00", closes_at: "22:00:00", open_days: [], accepts_preorder: true,
  preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], preorder_opens_at: "13:00:00", preorder_cutoff_time: "02:00:00", delivery_days: ["wed", "sun"],
  delivery_slots_enabled: true, delivery_slot_minutes: 120, preorder_delivery_start: "09:00:00", preorder_delivery_end: "11:00:00", preorder_days_ahead: 2,
} as MsgSeller;
const SELLERS = [FISHTOKRI, NOMADIC];
const T = (d: string, hm: string) => Date.parse(`2026-10-${d}T${hm}:00+05:30`); // Fri 23, Sat 24, Sun 25, Mon 26
const buyer = (o: Partial<BuyerState> = {}): BuyerState => ({
  id: "b", created_at: new Date(T("20", "10:00")).toISOString(), lat: 19.2, lng: 72.97, cart: [],
  last_order_at: null, open_order: false, last_delivered_at: null, opted_out: false, ...o,
});
const iso = (ms: number) => new Date(ms).toISOString();
const log = (kind: string, ms: number): SentLog => ({ kind, slot_date: new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10), created_at: iso(ms) });
const run = (now: number, b: BuyerState, h: SentLog[] = []) => decide(now, b, SELLERS, h) as any;

describe("seller slots come from DB timings", () => {
  it("morning = later of 9:30 and opens_at; evening 19:00 inside the pre-order window", () => {
    expect(morningMin(FISHTOKRI)).toBe(9 * 60 + 30);
    expect(eveningMin(FISHTOKRI)).toBe(19 * 60);
    expect(eveningMin(NOMADIC)).toBe(19 * 60); // window 13:00 → 02:00
    expect(eveningMin({ ...FISHTOKRI, preorder_cutoff_time: "20:00:00" } as MsgSeller)).toBe(18 * 60); // cutoff − 2h
  });
  it("offer follows the checkout picker, not the clock", () => {
    expect(offerAt(FISHTOKRI, T("23", "09:30"))).toEqual({ mode: "today" });
    expect(offerAt(FISHTOKRI, T("23", "16:30"))?.mode).toBe("preorder"); // shop open, but no Today slot left
    expect(offerAt(FISHTOKRI, T("26", "09:30"))?.mode).toBe("preorder"); // Monday: no same-day
    expect(offerAt(NOMADIC, T("25", "09:30"))).toBeNull();               // Sunday delivery-morning pause
    expect(offerAt(NOMADIC, T("24", "19:00"))).toEqual({ mode: "preorder", when: "Sun 25 Oct, 9–11 AM" });
  });
});

describe("Journey A: signed up, nothing else (generic)", () => {
  const b = buyer({ created_at: iso(T("23", "10:00")) });
  it("A1 at +1h, order-today text when the shop can deliver today", () => {
    expect(run(T("23", "10:30"), b)).toEqual({ skip: "nothing due" });
    const d = run(T("23", "11:00"), b);
    expect(d).toMatchObject({ kind: "A1", template: "rf_today_check", path: "/shop", personal: false });
  });
  it("A2 the next day at the same clock time", () => {
    const d = run(T("24", "10:00"), b, [log("A1", T("23", "11:00"))]);
    expect(d).toMatchObject({ kind: "A2" });
  });
  it("late-night sign-up: A1 next day, clamped to 20:30, pre-order text after close", () => {
    const late = buyer({ created_at: iso(T("22", "22:30")) });
    expect(run(T("22", "23:30"), late).skip).toBe("quiet hours");
    expect(run(T("23", "20:30"), late)).toMatchObject({ kind: "A1", template: "rf_preorder_generic", when: "Sat 24 Oct, 8–10 AM" });
  });
});

describe("Journey B: cart, no order (personalised)", () => {
  const cart = (seller: string, at: number, on = true) => [{ seller_id: seller, name: "Baby Rawas", on_menu: on, updated_at: iso(at) }];
  it("B1 at +1h names their fish; Today when a slot is left", () => {
    expect(run(T("23", "11:15"), buyer({ cart: cart("ft", T("23", "10:15")) }))).toMatchObject({
      kind: "B1", template: "rf_cart_today", items: ["Baby Rawas"], path: "/s/fishtokri", personal: true,
    });
  });
  it("B1 at 16:30 switches to pre-order: checkout has no Today slot then", () => {
    expect(run(T("23", "16:30"), buyer({ cart: cart("ft", T("23", "15:30")) }))).toMatchObject({ kind: "B1", template: "rf_cart_preorder" });
  });
  it("B2 next day: morning 9:30 if Today is possible (Sat)", () => {
    const b = buyer({ cart: cart("ft", T("23", "10:15")) });
    expect(run(T("24", "09:30"), b, [log("B1", T("23", "11:15"))])).toMatchObject({ kind: "B2", template: "rf_cart_today" });
  });
  it("B2 on Monday goes in the evening as a pre-order (Fishtokri has no same-day Monday)", () => {
    const b = buyer({ cart: cart("ft", T("25", "11:00")) });
    const h = [log("B1", T("25", "12:00"))];
    expect(run(T("26", "09:30"), b, h).skip).toBe("nothing due");
    expect(run(T("26", "19:00"), b, h)).toMatchObject({ kind: "B2", template: "rf_cart_preorder" });
  });
  it("Nomadic cart never gets a morning message", () => {
    const b = buyer({ cart: cart("nm", T("23", "10:00")) });
    const h = [log("B1", T("23", "11:00"))];
    expect(run(T("24", "09:30"), b, h).skip).toBe("nothing due");
    expect(run(T("24", "19:00"), b, h)).toMatchObject({ kind: "B2", template: "rf_cart_preorder", when: "Sun 25 Oct, 9–11 AM", path: "/s/the-nomadic-catch" });
  });
  it("no item still on the menu → generic text and /shop", () => {
    expect(run(T("23", "11:15"), buyer({ cart: cart("ft", T("23", "10:15"), false) }))).toMatchObject({
      kind: "B1", personal: false, template: "rf_today_check", path: "/shop",
    });
  });
  it("a job running up to 2h late still sends; later it doesn't", () => {
    const b = buyer({ cart: cart("ft", T("23", "09:00")) });
    expect(run(T("23", "11:30"), b)).toMatchObject({ kind: "B1" });
    expect(run(T("23", "12:30"), b).skip).toBe("nothing due");
  });
});

describe("Weekly weekend message (one per day)", () => {
  const old = buyer({ created_at: iso(T("10", "10:00")) }); // signed up 13 days ago, A done
  const h = [log("A1", T("10", "11:00")), log("A2", T("11", "11:00"))];
  it("Fri 19:00 pre-order; Sat & Sun 9:30 order today (Fishtokri)", () => {
    expect(run(T("23", "19:00"), old, h)).toMatchObject({ kind: "weekend", template: "rf_preorder_generic" });
    expect(run(T("24", "09:30"), old, h)).toMatchObject({ kind: "weekend", template: "rf_weekend_menu" });
    expect(run(T("25", "09:30"), old, h)).toMatchObject({ kind: "weekend", template: "rf_weekend_menu" });
  });
  it("only one promo a day: Saturday's evening slot is skipped after the morning one", () => {
    expect(run(T("24", "19:00"), old, [...h, log("weekend", T("24", "09:30"))]).skip).toBe("already messaged today");
  });
  it("Nomadic Sunday: no morning (paused), evening pre-order for Wednesday", () => {
    const nb = buyer({ created_at: iso(T("10", "10:00")), lat: 19.2186, lng: 72.9557, cart: [{ seller_id: "nm", name: "Bangda", on_menu: true, updated_at: iso(T("01", "10:00")) }] });
    expect(run(T("25", "09:30"), nb, h).skip).toBe("nothing due");
    expect(run(T("25", "19:00"), nb, h)).toMatchObject({ kind: "weekend", when: "Wed 28 Oct, 9–11 AM" });
  });
  it("no weekend message on weekdays, for inactive buyers, or within 3 days of a delivery", () => {
    expect(run(T("26", "19:00"), old, h).skip).toBe("nothing due");
    expect(run(T("23", "19:00"), buyer({ created_at: iso(T("01", "10:00")).replace("-10-", "-09-") }), h).skip).toBe("nothing due");
    expect(run(T("23", "19:00"), old, h.concat()) && run(T("23", "19:00"), { ...old, last_order_at: iso(T("21", "10:00")), last_delivered_at: iso(T("22", "10:00")) }, h).skip).toBe("nothing due");
  });
});

describe("guards", () => {
  const b = buyer({ created_at: iso(T("23", "10:00")) });
  it("opted out, open order, quiet hours, already messaged today", () => {
    expect(run(T("23", "11:00"), { ...b, opted_out: true }).skip).toBe("opted out");
    expect(run(T("23", "11:00"), { ...b, open_order: true }).skip).toBe("open order");
    expect(run(T("23", "21:30"), b).skip).toBe("quiet hours");
    expect(run(T("23", "11:00"), b, [log("weekend", T("23", "09:30"))]).skip).toBe("already messaged today");
  });
  it("no seller delivers to the buyer → skip", () => {
    expect(run(T("23", "11:00"), { ...b, lat: 18.5, lng: 73.8 }).skip).toBe("no seller delivers to them");
  });
});
