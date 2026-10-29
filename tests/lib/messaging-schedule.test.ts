import { describe, expect, it } from "vitest";
import { decide, eveningMin, morningMin, offerAt, type BuyerState, type MsgSeller, type SentLog } from "../../src/lib/messaging/schedule";
import { varCount } from "../../src/lib/messaging/templates";

// Live prod settings (24 Oct 2026).
const FISHTOKRI: MsgSeller = {
  id: "ft", name: "Fishtokri", slug: "fishtokri", lat: 19.1906444, lng: 72.9791824, delivery_rad: 7,
  opens_at: "08:00:00", closes_at: "18:00:00", open_days: ["tue", "wed", "thu", "fri", "sat", "sun"], accepts_preorder: true,
  preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat"], preorder_opens_at: null, preorder_cutoff_time: "03:00:00", delivery_days: null,
  delivery_slots_enabled: true, delivery_slot_minutes: 120, preorder_delivery_start: "08:00:00", preorder_delivery_end: "18:00:00", preorder_days_ahead: 3,
  menu: "Surmai · Pomfret · Bombil",
} as MsgSeller;
const NOMADIC: MsgSeller = {
  id: "nm", name: "The Nomadic Catch", slug: "the-nomadic-catch", lat: 19.2186389, lng: 72.9557714, delivery_rad: 6,
  opens_at: "08:00:00", closes_at: "22:00:00", open_days: [], accepts_preorder: true,
  preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], preorder_opens_at: "13:00:00", preorder_cutoff_time: "02:00:00", delivery_days: ["wed", "sun"],
  delivery_slots_enabled: true, delivery_slot_minutes: 120, preorder_delivery_start: "09:00:00", preorder_delivery_end: "11:00:00", preorder_days_ahead: 2,
  menu: "Halwa · Surmai",
} as MsgSeller;
const SELLERS = [FISHTOKRI, NOMADIC];
const T = (d: string, hm: string) => Date.parse(`2026-10-${d}T${hm}:00+05:30`); // Tue 20, Fri 23, Sat 24, Sun 25, Mon 26, Tue 27
const buyer = (o: Partial<BuyerState> = {}): BuyerState => ({
  id: "b", created_at: new Date(T("20", "10:00")).toISOString(), name: "Priya", lat: 19.2, lng: 72.97, cart: [],
  last_order_at: null, open_order: false, unpaid: null, delivered: null, last_delivered_at: null, opted_out: false, ...o,
});
const iso = (ms: number) => new Date(ms).toISOString();
const log = (kind: string, ms: number): SentLog => ({ kind, slot_date: new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10), created_at: iso(ms) });
/** Every decision fills exactly the variables Meta's template has. */
const run = (now: number, b: BuyerState, h: SentLog[] = [], sellers = SELLERS) => {
  const d = decide(now, b, sellers, h) as any;
  if (!d.skip) expect(d.body, d.template).toHaveLength(varCount(d.template));
  return d;
};

describe("seller slots come from DB timings", () => {
  it("morning = later of 9:30 and opens_at; evening 19:00 inside the pre-order window", () => {
    expect(morningMin(FISHTOKRI)).toBe(9 * 60 + 30);
    expect(eveningMin(FISHTOKRI)).toBe(19 * 60);
    expect(eveningMin(NOMADIC)).toBe(19 * 60); // window 13:00 → 02:00
    expect(eveningMin({ ...FISHTOKRI, preorder_cutoff_time: "20:00:00" } as MsgSeller)).toBe(18 * 60); // cutoff − 2h
  });
  it("offer follows the checkout picker, not the clock", () => {
    expect(offerAt(FISHTOKRI, T("23", "09:30"))).toEqual({ mode: "today", date: "2026-10-23", when: "today, 10 AM–12 PM" });
    expect(offerAt(FISHTOKRI, T("23", "16:30"))?.mode).toBe("preorder"); // shop open, but no Today slot left
    expect(offerAt(FISHTOKRI, T("26", "09:30"))?.mode).toBe("preorder"); // Monday: no same-day
    expect(offerAt(NOMADIC, T("25", "09:30"))?.mode).toBe("preorder");   // Sunday after the 2 AM cutoff: next delivery day (no pause)
    expect(offerAt(NOMADIC, T("24", "19:00"))).toEqual({ mode: "preorder", date: "2026-10-25", when: "Sun 25 Oct, 9–11 AM" });
  });
});

describe("Journey A: welcome is on hold", () => {
  it("a new sign-up with nothing else gets no message", () => {
    const b = buyer({ created_at: iso(T("23", "10:00")) });
    expect(run(T("23", "11:00"), b)).toEqual({ skip: "nothing due" });
    expect(run(T("24", "10:00"), b)).toEqual({ skip: "nothing due" });
  });
});

describe("Journey B: cart, no order (personalised)", () => {
  const cart = (seller: string, at: number, on = true) => [{ seller_id: seller, name: "Baby Rawas", on_menu: on, updated_at: iso(at) }];
  it("B1 at +1h names them, their fish, the seller and the slot; Today when a slot is left", () => {
    expect(run(T("23", "11:15"), buyer({ cart: cart("ft", T("23", "10:15")) }))).toMatchObject({
      kind: "B1", template: "rf2_cart_today", body: ["Priya", "Baby Rawas", "Fishtokri", "today, 12–2 PM"], path: "/s/fishtokri", personal: true,
    });
  });
  it("B1 at 16:30 switches to pre-order: checkout has no Today slot then", () => {
    expect(run(T("23", "16:30"), buyer({ cart: cart("ft", T("23", "15:30")) }))).toMatchObject({
      kind: "B1", template: "rf2_cart_preorder", body: ["Priya", "Baby Rawas", "Fishtokri", "Sat 24 Oct, 8–10 AM"],
    });
  });
  it("B2 next day: morning 9:30 if Today is possible (Sat)", () => {
    const b = buyer({ cart: cart("ft", T("23", "10:15")) });
    expect(run(T("24", "09:30"), b, [log("B1", T("23", "11:15"))])).toMatchObject({ kind: "B2", template: "rf2_cart_today" });
  });
  it("B2 on Monday goes in the evening as a pre-order (Fishtokri has no same-day Monday)", () => {
    const b = buyer({ cart: cart("ft", T("25", "11:00")) });
    const h = [log("B1", T("25", "12:00"))];
    expect(run(T("26", "09:30"), b, h).skip).toBe("nothing due");
    expect(run(T("26", "19:00"), b, h)).toMatchObject({ kind: "B2", template: "rf2_cart_preorder" });
  });
  it("Nomadic cart never gets a morning message", () => {
    const b = buyer({ cart: cart("nm", T("23", "10:00")) });
    const h = [log("B1", T("23", "11:00"))];
    expect(run(T("24", "09:30"), b, h).skip).toBe("nothing due");
    expect(run(T("24", "19:00"), b, h)).toMatchObject({ kind: "B2", template: "rf2_cart_preorder", when: "Sun 25 Oct, 9–11 AM", path: "/s/the-nomadic-catch" });
  });
  it("no item still on the menu → no cart message", () => {
    expect(run(T("23", "11:15"), buyer({ cart: cart("ft", T("23", "10:15"), false) })).skip).toBe("nothing due");
  });
  it("a job running up to 2h late still sends; later it doesn't", () => {
    const b = buyer({ cart: cart("ft", T("23", "09:00")) });
    expect(run(T("23", "11:30"), b)).toMatchObject({ kind: "B1" });
    expect(run(T("23", "12:30"), b).skip).toBe("nothing due");
  });
});

describe("Tue/Fri 7:30 PM promo, one per buyer by stage", () => {
  const old = buyer({ created_at: iso(T("10", "10:00")) }); // signed up 13 days ago
  it("generic: Fri and Tue 7:30 PM, tomorrow's pre-order with the seller's fish and cutoff", () => {
    expect(run(T("23", "19:30"), old)).toMatchObject({
      kind: "promo", template: "rf2_catch_preorder", path: "/shop", personal: false,
      body: ["Priya", "Friday", "Surmai · Pomfret · Bombil", "3 AM", "Sat 24 Oct, 8–10 AM"],
    });
    expect(run(T("27", "19:30"), buyer({ created_at: iso(T("20", "10:00")) }))).toMatchObject({ kind: "promo", template: "rf2_catch_preorder", body: ["Priya", "Tuesday", "Surmai · Pomfret · Bombil", "3 AM", "Wed 28 Oct, 8–10 AM"] });
  });
  it("only Tue and Fri, only from 7:30 PM", () => {
    expect(run(T("23", "19:00"), old).skip).toBe("nothing due");
    for (const d of ["24", "25", "26"]) expect(run(T(d, "19:30"), old).skip).toBe("nothing due");
    expect(run(T("23", "20:45"), old)).toMatchObject({ kind: "promo" }); // job late, still inside send hours
  });
  it("generic needs a pre-order for tomorrow (Nomadic delivers Wed/Sun only)", () => {
    expect(run(T("23", "19:30"), old, [], [NOMADIC]).skip).toBe("nothing due");
  });
  it("cart → rf2_promo_cart with their fish and seller", () => {
    const b = buyer({ created_at: iso(T("10", "10:00")), cart: [{ seller_id: "ft", name: "Baby Rawas", on_menu: true, updated_at: iso(T("19", "10:00")) }] });
    const h = [log("B1", T("19", "11:00")), log("B2", T("20", "19:00"))];
    expect(run(T("23", "19:30"), b, h)).toMatchObject({
      kind: "promo", template: "rf2_promo_cart", path: "/s/fishtokri",
      body: ["Friday", "Priya", "Baby Rawas", "Fishtokri", "Sat 24 Oct, 8–10 AM"],
    });
  });
  it("unpaid order → rf2_promo_unpaid with that order's seller slot, link to its pay page", () => {
    const b = buyer({ created_at: iso(T("10", "10:00")), last_order_at: iso(T("23", "11:00")), unpaid: { id: "o1", seller_id: "nm", name: "Surmai" } });
    expect(run(T("23", "19:30"), b)).toMatchObject({
      kind: "promo", template: "rf2_promo_unpaid", path: "/track/o1", body: ["Friday", "Priya", "Surmai", "Sun 25 Oct, 9–11 AM"],
    });
  });
  it("delivered before → rf2_order_again from the same seller", () => {
    const b = buyer({ created_at: iso(T("10", "10:00")), last_order_at: iso(T("15", "10:00")), last_delivered_at: iso(T("16", "10:00")),
      delivered: { id: "o2", seller_id: "ft", name: "Pomfret" } });
    expect(run(T("23", "19:30"), b)).toMatchObject({
      kind: "promo", template: "rf2_order_again", path: "/s/fishtokri", body: ["Priya", "Pomfret", "Fishtokri", "Sat 24 Oct, 8–10 AM"],
    });
  });
  it("paid and awaiting delivery → none; none within 3 days of a delivery or 2 days of another reminder", () => {
    expect(run(T("23", "19:30"), { ...old, open_order: true }).skip).toBe("open order");
    expect(run(T("23", "19:30"), { ...old, last_order_at: iso(T("21", "10:00")), last_delivered_at: iso(T("22", "10:00")) }).skip).toBe("nothing due");
    expect(run(T("23", "19:30"), old, [log("B2", T("22", "09:30"))]).skip).toBe("nothing due");
    expect(run(T("23", "19:30"), old, [log("B2", T("21", "09:30"))])).toMatchObject({ kind: "promo" });
  });
  it("one marketing message a day; inactive buyers get none", () => {
    expect(run(T("23", "19:30"), old, [log("B1", T("23", "10:00"))]).skip).toBe("already messaged today");
    expect(run(T("23", "19:30"), buyer({ created_at: iso(T("01", "10:00")).replace("-10-", "-09-") })).skip).toBe("nothing due");
  });
});

describe("guards", () => {
  const b = buyer({ created_at: iso(T("23", "10:00")) });
  it("opted out, open order, quiet hours, already messaged today", () => {
    expect(run(T("23", "11:00"), { ...b, opted_out: true }).skip).toBe("opted out");
    expect(run(T("23", "11:00"), { ...b, open_order: true }).skip).toBe("open order");
    expect(run(T("23", "21:30"), b).skip).toBe("quiet hours");
    expect(run(T("23", "11:00"), b, [log("promo", T("23", "09:30"))]).skip).toBe("already messaged today");
  });
  it("no seller delivers to the buyer → skip", () => {
    expect(run(T("23", "11:00"), { ...b, lat: 18.5, lng: 73.8 }).skip).toBe("no seller delivers to them");
  });
});
