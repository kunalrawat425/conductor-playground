import { describe, expect, it } from "vitest";
import { decide, offerAt, type BuyerState, type MsgSeller, type SentLog } from "../../src/lib/messaging/schedule";
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
const T = (d: string, hm: string) => Date.parse(`2026-10-${d}T${hm}:00+05:30`); // Tue 20, Wed 21, Thu 22, Fri 23, Sat 24, Sun 25, Mon 26, Tue 27
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

describe("seller offer comes from DB timings", () => {
  it("offer follows the checkout picker, not the clock", () => {
    expect(offerAt(FISHTOKRI, T("23", "09:30"))).toEqual({ mode: "today", date: "2026-10-23", when: "today, 10 AM–12 PM", by: "4 PM" }); // last Today slot 4–6 PM: bookable until 4 PM
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
    expect(run(T("26", "10:00"), b)).toEqual({ skip: "nothing due" }); // Monday: no promo slot
  });
});

describe("Journey B: cart reminders B1/B2 are removed (founder, 30 Oct)", () => {
  const cart = (seller: string, at: number, on = true) => [{ seller_id: seller, name: "Baby Rawas", on_menu: on, updated_at: iso(at) }];
  it("a cart never gets B1/B2: nothing outside the promo slots, all week", () => {
    const b = buyer({ cart: cart("ft", T("23", "10:15")) });
    for (const d of ["23", "24", "25", "26", "27"]) for (const hm of ["08:00", "09:30", "11:15", "13:00", "16:30", "19:00", "20:30"]) {
      const r = run(T(d, hm), b);
      expect(["B1", "B2"], `${d} ${hm}`).not.toContain(r.kind);
      expect(["rf2_cart_today", "rf2_cart_preorder"]).not.toContain(r.template);
    }
  });
  it("a cart is covered by the next slot: rf2_promo_cart (Sat 8:30 for a Fri cart)", () => {
    expect(run(T("23", "11:15"), buyer({ cart: cart("ft", T("23", "10:15")) })).skip).toBe("nothing due");
    expect(run(T("24", "08:30"), buyer({ cart: cart("ft", T("23", "10:15")) }))).toMatchObject({
      kind: "promo", template: "rf2_promo_cart", personal: true, path: "/s/fishtokri", body: ["Saturday", "Priya", "Baby Rawas", "Fishtokri", "today, 10 AM–12 PM"],
    });
    // Nomadic cart on Saturday morning: pre-order slot for Sunday (no B2 to wait for any more).
    expect(run(T("24", "08:30"), buyer({ cart: cart("nm", T("23", "10:00")) }))).toMatchObject({
      template: "rf2_promo_cart", when: "Sun 25 Oct, 9–11 AM", path: "/s/the-nomadic-catch",
    });
  });
  it("no item still on the menu → not a cart message", () => {
    expect(run(T("23", "18:00"), buyer({ created_at: iso(T("10", "10:00")), cart: cart("ft", T("23", "10:15"), false) })).template).not.toBe("rf2_promo_cart");
  });
  it("old B1/B2 rows in the log still count for the 72 h gap and one-per-day", () => {
    const b = buyer({ cart: cart("ft", T("22", "10:00")) });
    expect(run(T("23", "18:00"), b, [log("B1", T("22", "11:00"))]).skip).toBe("nothing due");
    expect(run(T("23", "18:00"), b, [log("B2", T("23", "09:30"))]).skip).toBe("already messaged today");
  });
});

describe("Tue/Fri 6 PM + Sat/Sun 8:30 AM promo, one per buyer by stage", () => {
  const old = buyer({ created_at: iso(T("10", "10:00")) }); // signed up 13 days ago
  it("generic evenings: tomorrow's pre-order with the seller's fish and cutoff", () => {
    expect(run(T("23", "18:00"), old)).toMatchObject({
      kind: "promo", template: "rf2_catch_preorder", path: "/shop", personal: false,
      body: ["Priya", "Friday", "Surmai · Pomfret · Bombil", "3 AM", "Sat 24 Oct, 8–10 AM"],
    });
    expect(run(T("27", "18:00"), old)).toMatchObject({ kind: "promo", template: "rf2_catch_preorder", body: ["Priya", "Tuesday", "Surmai · Pomfret · Bombil", "3 AM", "Wed 28 Oct, 8–10 AM"] });
  });
  it("each of the 4 slots fires at its time; never Mon, Wed or Thu", () => {
    expect(run(T("27", "18:00"), old)).toMatchObject({ kind: "promo", template: "rf2_catch_preorder" }); // Tue 6 PM
    expect(run(T("23", "18:00"), old)).toMatchObject({ kind: "promo", template: "rf2_catch_preorder" }); // Fri 6 PM
    expect(run(T("24", "08:30"), old)).toMatchObject({ kind: "promo", template: "rf2_catch_prices" });   // Sat 8:30 AM
    expect(run(T("25", "08:30"), old)).toMatchObject({ kind: "promo", template: "rf2_catch_prices" });   // Sun 8:30 AM (inside DAY_START 8:00)
    expect(run(T("27", "17:30"), old).skip).toBe("nothing due"); // not before 6 PM
    expect(run(T("24", "08:00"), old).skip).toBe("nothing due"); // not before 8:30
    expect(run(T("24", "18:00"), old).skip).toBe("nothing due"); // weekend slots are mornings only
    expect(run(T("23", "08:30"), old).skip).toBe("nothing due"); // weekday slots are evenings only
    for (const d of ["26", "21", "22"]) for (const hm of ["08:30", "18:00", "19:30"]) expect(run(T(d, hm), old).skip, `${d} ${hm}`).toBe("nothing due");
    expect(run(T("23", "19:45"), old)).toMatchObject({ kind: "promo" }); // job late, still inside the 2 h window
  });
  it("weekend morning generic with a Today slot → rf2_catch_prices: menu, order-by (last Today slot end − 2 h), first slot", () => {
    const d = run(T("24", "08:30"), old);
    expect(d).toMatchObject({
      kind: "promo", template: "rf2_catch_prices", mode: "today", path: "/shop", personal: false,
      body: ["Priya", "Saturday", "Surmai · Pomfret · Bombil", "4 PM", "today, 10 AM–12 PM"],
    });
    expect(d.body).toHaveLength(5);
    expect(run(T("25", "08:30"), old).body).toEqual(["Priya", "Sunday", "Surmai · Pomfret · Bombil", "4 PM", "today, 10 AM–12 PM"]);
    // A shop closing at 8 PM: last Today slot 6–8 PM, bookable until 6 PM.
    expect(run(T("24", "08:30"), old, [], [{ ...FISHTOKRI, closes_at: "20:00:00" } as MsgSeller]).body[3]).toBe("6 PM");
  });
  it("weekend morning with pre-order only → rf2_catch_preorder; neither fits → none", () => {
    // Nomadic (no same-day) delivers Sunday: Saturday gets the pre-order for tomorrow.
    expect(run(T("24", "08:30"), old, [], [NOMADIC])).toMatchObject({
      template: "rf2_catch_preorder", mode: "preorder", body: ["Priya", "Saturday", "Halwa · Surmai", "2 AM", "Sun 25 Oct, 9–11 AM"],
    });
    expect(run(T("25", "08:30"), old, [], [NOMADIC]).skip).toBe("nothing due"); // Sunday: next delivery is Wed, not tomorrow
  });
  it("evenings never use rf2_catch_prices, even with a Today slot still open", () => {
    const late = { ...FISHTOKRI, closes_at: "23:59:00" } as MsgSeller; // Today slots until midnight
    expect(run(T("23", "18:00"), old, [], [late]).skip).toBe("nothing due"); // as before: an evening generic needs tomorrow's pre-order
  });
  it("generic needs a pre-order for tomorrow (Nomadic delivers Wed/Sun only)", () => {
    expect(run(T("23", "18:00"), old, [], [NOMADIC]).skip).toBe("nothing due");
  });
  it("cart → rf2_promo_cart with their fish and seller", () => {
    const b = buyer({ created_at: iso(T("10", "10:00")), cart: [{ seller_id: "ft", name: "Baby Rawas", on_menu: true, updated_at: iso(T("17", "10:00")) }] });
    expect(run(T("23", "18:00"), b)).toMatchObject({
      kind: "promo", template: "rf2_promo_cart", path: "/s/fishtokri",
      body: ["Friday", "Priya", "Baby Rawas", "Fishtokri", "Sat 24 Oct, 8–10 AM"],
    });
  });
  it("unpaid order → rf2_promo_unpaid with that order's seller slot, link to its pay page", () => {
    const b = buyer({ created_at: iso(T("10", "10:00")), last_order_at: iso(T("23", "11:00")), unpaid: { id: "o1", seller_id: "nm", name: "Surmai" } });
    expect(run(T("23", "18:00"), b)).toMatchObject({
      kind: "promo", template: "rf2_promo_unpaid", path: "/track/o1", body: ["Friday", "Priya", "Surmai", "Sun 25 Oct, 9–11 AM"],
    });
  });
  it("delivered before → rf2_order_again from the same seller", () => {
    const b = buyer({ created_at: iso(T("10", "10:00")), last_order_at: iso(T("15", "10:00")), last_delivered_at: iso(T("16", "10:00")),
      delivered: { id: "o2", seller_id: "ft", name: "Pomfret" } });
    expect(run(T("23", "18:00"), b)).toMatchObject({
      kind: "promo", template: "rf2_order_again", path: "/s/fishtokri", body: ["Priya", "Pomfret", "Fishtokri", "Sat 24 Oct, 8–10 AM"],
    });
  });
  it("paid and awaiting delivery → none; none within 3 days of a delivery", () => {
    expect(run(T("23", "18:00"), { ...old, open_order: true }).skip).toBe("open order");
    expect(run(T("23", "18:00"), { ...old, last_order_at: iso(T("21", "10:00")), last_delivered_at: iso(T("22", "10:00")) }).skip).toBe("nothing due");
  });
  it("72 h gap since the last marketing message", () => {
    // Tue 6 PM → Fri 6 PM is exactly 72 h: Friday is allowed.
    expect(run(T("23", "18:00"), old, [log("promo", T("20", "18:00"))])).toMatchObject({ kind: "promo" });
    expect(run(T("23", "18:00"), old, [log("promo", T("20", "18:01"))]).skip).toBe("nothing due"); // 71 h 59 min
    // A Fri 6 PM send blocks Sat and Sun 8:30 AM; next Tue 6 PM (96 h) goes.
    const fri = [log("promo", T("20", "18:00")), log("promo", T("23", "18:00"))];
    expect(run(T("24", "08:30"), old, fri).skip).toBe("nothing due");
    expect(run(T("25", "08:30"), old, fri).skip).toBe("nothing due");
    expect(run(T("27", "18:00"), old, fri)).toMatchObject({ kind: "promo" });
    // Old B1/B2 rows count too: a Thu B2 blocks Fri. A Sat send blocks Sun; Tue (81.5 h later) is allowed.
    expect(run(T("23", "18:00"), old, [log("B2", T("22", "19:00"))]).skip).toBe("nothing due");
    expect(run(T("25", "08:30"), old, [log("promo", T("24", "08:30"))]).skip).toBe("nothing due");
    expect(run(T("27", "18:00"), old, [log("promo", T("24", "08:30"))])).toMatchObject({ kind: "promo" });
  });
  it("one marketing message a day; inactive buyers get none", () => {
    expect(run(T("23", "18:00"), old, [log("B1", T("23", "10:00"))]).skip).toBe("already messaged today");
    expect(run(T("23", "18:00"), buyer({ created_at: iso(T("01", "10:00")).replace("-10-", "-09-") })).skip).toBe("nothing due");
  });
  it("a job up to 2 h late still sends; later it doesn't", () => {
    expect(run(T("23", "19:59"), old)).toMatchObject({ kind: "promo" });
    expect(run(T("23", "20:00"), old).skip).toBe("nothing due");
    expect(run(T("24", "10:29"), old)).toMatchObject({ kind: "promo" });
    expect(run(T("24", "10:30"), old).skip).toBe("nothing due");
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
