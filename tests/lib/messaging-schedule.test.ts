import { describe, expect, it } from "vitest";
import { compose, costliestPhoto, decide, decideActivity, offerAt, reminderWindow, pickSubstitute, type BuyerState, type MenuItem, type MsgSeller, type SentLog } from "../../src/lib/messaging/schedule";
import { PROMO_IMAGE, SIGNUP_IMAGE, varCount } from "../../src/lib/messaging/templates";
import { DEFAULT_PROMO_IMAGE } from "../../src/lib/server/buyer-order-push-copy";

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

describe("promos: a sign-up alone gets no promo (the 1 h welcome is decideActivity)", () => {
  it("a new sign-up with nothing else gets no promo", () => {
    const b = buyer({ created_at: iso(T("23", "10:00")) });
    expect(run(T("23", "11:00"), b)).toEqual({ skip: "nothing due" });
    expect(run(T("26", "10:00"), b)).toEqual({ skip: "nothing due" }); // Monday: no promo slot
  });
});

describe("promos: a cart is only covered by promo slots here (the 1 h cart reminder is decideActivity)", () => {
  const cart = (seller: string, at: number, on = true) => [{ seller_id: seller, name: "Baby Rawas", on_menu: on, updated_at: iso(at) }];
  it("decide() never sends B1/B2 or cart_today/preorder outside the promo slots", () => {
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
    expect(run(T("27", "18:00"), buyer({ created_at: iso(T("10", "10:00")), cart: cart("ft", T("23", "10:15"), false) })).template).not.toBe("rf2_promo_cart");
  });
  it("old B1/B2 rows in the log still count for the 72 h gap and one-per-day", () => {
    const b = buyer({ cart: cart("ft", T("22", "10:00")) });
    expect(run(T("23", "08:30"), b, [log("B1", T("22", "11:00"))]).skip).toBe("nothing due");
    expect(run(T("23", "08:30"), b, [log("B2", T("23", "08:00"))]).skip).toBe("already messaged today");
  });
});

describe("Tue 6 PM + Fri/Sat/Sun 8:30 AM promo, one per buyer by stage", () => {
  const old = buyer({ created_at: iso(T("10", "10:00")) }); // signed up 13 days ago
  it("generic Tue evening: tomorrow's pre-order with the seller's fish and cutoff", () => {
    expect(run(T("20", "18:00"), old)).toMatchObject({
      kind: "promo", template: "rf2_catch_preorder", path: "/shop", personal: false,
      body: ["Priya", "Tuesday", "Surmai · Pomfret · Bombil", "3 AM", "Wed 21 Oct, 8–10 AM"],
    });
    expect(run(T("27", "18:00"), old)).toMatchObject({ kind: "promo", template: "rf2_catch_preorder", body: ["Priya", "Tuesday", "Surmai · Pomfret · Bombil", "3 AM", "Wed 28 Oct, 8–10 AM"] });
  });
  it("each of the 4 slots fires at its time; never Mon, Wed or Thu", () => {
    expect(run(T("27", "18:00"), old)).toMatchObject({ kind: "promo", template: "rf2_catch_preorder" }); // Tue 6 PM
    expect(run(T("23", "08:30"), old)).toMatchObject({ kind: "promo", template: "rf2_catch_prices" });   // Fri 8:30 AM
    expect(run(T("24", "08:30"), old)).toMatchObject({ kind: "promo", template: "rf2_catch_prices" });   // Sat 8:30 AM
    expect(run(T("25", "08:30"), old)).toMatchObject({ kind: "promo", template: "rf2_catch_prices" });   // Sun 8:30 AM (inside DAY_START 8:00)
    expect(run(T("27", "17:30"), old).skip).toBe("nothing due"); // not before 6 PM
    expect(run(T("24", "08:00"), old).skip).toBe("nothing due"); // not before 8:30
    expect(run(T("23", "08:00"), old).skip).toBe("nothing due"); // Fri: not before 8:30
    expect(run(T("23", "18:00"), old).skip).toBe("nothing due"); // Fri/Sat/Sun slots are mornings only
    expect(run(T("24", "18:00"), old).skip).toBe("nothing due");
    expect(run(T("27", "08:30"), old).skip).toBe("nothing due"); // Tue slot is evening only
    for (const d of ["26", "21", "22"]) for (const hm of ["08:30", "18:00", "19:30"]) expect(run(T(d, hm), old).skip, `${d} ${hm}`).toBe("nothing due");
    expect(run(T("27", "19:45"), old)).toMatchObject({ kind: "promo" }); // job late, still inside the 2 h window
  });
  it("Fri/Sat/Sun morning generic with a Today slot → rf2_catch_prices: menu, order-by (last Today slot end − 2 h), first slot", () => {
    const d = run(T("24", "08:30"), old);
    expect(d).toMatchObject({
      kind: "promo", template: "rf2_catch_prices", mode: "today", path: "/shop", personal: false,
      body: ["Priya", "Saturday", "Surmai · Pomfret · Bombil", "4 PM", "today, 10 AM–12 PM"],
    });
    expect(d.body).toHaveLength(5);
    expect(run(T("23", "08:30"), old).body).toEqual(["Priya", "Friday", "Surmai · Pomfret · Bombil", "4 PM", "today, 10 AM–12 PM"]);
    expect(run(T("25", "08:30"), old).body).toEqual(["Priya", "Sunday", "Surmai · Pomfret · Bombil", "4 PM", "today, 10 AM–12 PM"]);
    // A shop closing at 8 PM: last Today slot 6–8 PM, bookable until 6 PM.
    expect(run(T("24", "08:30"), old, [], [{ ...FISHTOKRI, closes_at: "20:00:00" } as MsgSeller]).body[3]).toBe("6 PM");
  });
  it("Fri/Sat/Sun morning with pre-order only → rf2_catch_preorder; neither fits → none", () => {
    // Nomadic (no same-day) delivers Sunday: Saturday gets the pre-order for tomorrow.
    expect(run(T("24", "08:30"), old, [], [NOMADIC])).toMatchObject({
      template: "rf2_catch_preorder", mode: "preorder", body: ["Priya", "Saturday", "Halwa · Surmai", "2 AM", "Sun 25 Oct, 9–11 AM"],
    });
    expect(run(T("25", "08:30"), old, [], [NOMADIC]).skip).toBe("nothing due"); // Sunday: next delivery is Wed, not tomorrow
  });
  it("evenings never use rf2_catch_prices, even with a Today slot still open", () => {
    const late = { ...FISHTOKRI, closes_at: "23:59:00" } as MsgSeller; // Today slots until midnight
    expect(run(T("27", "18:00"), old, [], [late]).skip).toBe("nothing due"); // as before: an evening generic needs tomorrow's pre-order
  });
  it("generic needs a pre-order for tomorrow (Nomadic delivers Wed/Sun only)", () => {
    expect(run(T("23", "08:30"), old, [], [NOMADIC]).skip).toBe("nothing due"); // Fri: next delivery is Sun, not tomorrow
  });
  it("cart → rf2_promo_cart with their fish and seller", () => {
    const b = buyer({ created_at: iso(T("10", "10:00")), cart: [{ seller_id: "ft", name: "Baby Rawas", on_menu: true, updated_at: iso(T("17", "10:00")) }] });
    expect(run(T("23", "08:30"), b)).toMatchObject({
      kind: "promo", template: "rf2_promo_cart", path: "/s/fishtokri",
      body: ["Friday", "Priya", "Baby Rawas", "Fishtokri", "today, 10 AM–12 PM"],
    });
  });
  it("unpaid order → rf2_promo_unpaid with that order's seller slot, link to its pay page", () => {
    const b = buyer({ created_at: iso(T("10", "10:00")), last_order_at: iso(T("22", "11:00")), unpaid: { id: "o1", seller_id: "nm", name: "Surmai" } });
    expect(run(T("23", "08:30"), b)).toMatchObject({
      kind: "promo", template: "rf2_promo_unpaid", path: "/track/o1", body: ["Friday", "Priya", "Surmai", "Sun 25 Oct, 9–11 AM"],
    });
  });
  it("delivered before → rf2_order_again from the same seller", () => {
    const b = buyer({ created_at: iso(T("10", "10:00")), last_order_at: iso(T("15", "10:00")), last_delivered_at: iso(T("16", "10:00")),
      delivered: { id: "o2", seller_id: "ft", name: "Pomfret" } });
    expect(run(T("23", "08:30"), b)).toMatchObject({
      kind: "promo", template: "rf2_order_again", path: "/s/fishtokri", body: ["Priya", "Pomfret", "Fishtokri", "today, 10 AM–12 PM"],
    });
  });
  it("paid and awaiting delivery → none; none within 3 days of a delivery", () => {
    expect(run(T("23", "08:30"), { ...old, open_order: true }).skip).toBe("open order");
    expect(run(T("23", "08:30"), { ...old, last_order_at: iso(T("21", "10:00")), last_delivered_at: iso(T("22", "10:00")) }).skip).toBe("nothing due");
  });
  it("72 h gap since the last marketing message", () => {
    // Tue 6 PM → Fri 8:30 AM is 62.5 h: a Tuesday recipient is skipped on Friday.
    expect(run(T("23", "08:30"), old, [log("promo", T("20", "18:00"))]).skip).toBe("nothing due");
    // Exactly 72 h is allowed; 71 h 59 min is not.
    expect(run(T("23", "08:30"), old, [log("B1", T("20", "08:30"))])).toMatchObject({ kind: "promo" });
    expect(run(T("23", "08:30"), old, [log("B1", T("20", "08:31"))]).skip).toBe("nothing due");
    // A Fri 8:30 AM send blocks Sat and Sun 8:30 AM; next Tue 6 PM (105.5 h) goes.
    const fri = [log("promo", T("23", "08:30"))];
    expect(run(T("24", "08:30"), old, fri).skip).toBe("nothing due");
    expect(run(T("25", "08:30"), old, fri).skip).toBe("nothing due");
    expect(run(T("27", "18:00"), old, fri)).toMatchObject({ kind: "promo" });
    // Old B1/B2 rows count too: a Thu B2 blocks Fri. A Sat send blocks Sun; Tue (81.5 h later) is allowed.
    expect(run(T("23", "08:30"), old, [log("B2", T("22", "19:00"))]).skip).toBe("nothing due");
    expect(run(T("25", "08:30"), old, [log("promo", T("24", "08:30"))]).skip).toBe("nothing due");
    expect(run(T("27", "18:00"), old, [log("promo", T("24", "08:30"))])).toMatchObject({ kind: "promo" });
  });
  it("one marketing message a day; inactive buyers get none", () => {
    expect(run(T("27", "18:00"), old, [log("B1", T("27", "10:00"))]).skip).toBe("already messaged today");
    expect(run(T("27", "18:00"), buyer({ created_at: iso(T("01", "10:00")).replace("-10-", "-09-") })).skip).toBe("nothing due");
  });
  it("a job up to 2 h late still sends; later it doesn't", () => {
    expect(run(T("27", "19:59"), old)).toMatchObject({ kind: "promo" });
    expect(run(T("27", "20:00"), old).skip).toBe("nothing due");
    expect(run(T("24", "10:29"), old)).toMatchObject({ kind: "promo" });
    expect(run(T("24", "10:30"), old).skip).toBe("nothing due");
  });
});

describe("rf2_cart_swap: the cart's fish is off the seller's menu (founder, 30 Oct)", () => {
  const LIVE: MenuItem[] = [
    { name: "Baby Surmai", species: "surmai", price: 1040, label: "900–1000 g", photo: "https://x/surmai.jpg" },
    { name: "Silver Pomfret", species: "pomfret", price: 1380, label: "Per kg", photo: "https://x/pomfret.jpg" },
    { name: "Bombil", species: "bombil", price: 240, label: null, photo: null },
  ];
  const FT = { ...FISHTOKRI, live: LIVE } as MsgSeller;
  const line = (name: string, species: string, price: number, on_menu: boolean, at: number, seller_id = "ft") =>
    ({ seller_id, name, species, price, photo: `https://x/${name}.jpg`, on_menu, updated_at: iso(at) });
  const old = { created_at: iso(T("10", "10:00")) };
  it("all lines off the menu → rf2_cart_swap: 5 vars in order, substitute's photo, seller page", () => {
    const b = buyer({ ...old, cart: [line("Rawas", "rawas", 990, false, T("22", "10:00")), line("Halwa", "halwa", 700, false, T("23", "10:00")), line("Prawns", "prawns", 500, false, T("21", "10:00"))] });
    expect(run(T("27", "18:00"), b, [], [FT, NOMADIC])).toMatchObject({
      kind: "promo", template: "rf2_cart_swap", path: "/s/fishtokri", personal: true, photo: "https://x/surmai.jpg",
      // latest 2 off-menu names; substitute closest to the latest (Halwa ₹700): Surmai ₹1,040 (340 away) over Bombil ₹240 (460)
      body: ["Priya", "Halwa and Rawas", "Fishtokri", "Baby Surmai 900–1000 g, ₹1,040", "Wed 28 Oct, 8–10 AM"],
    });
  });
  it("any line still on the menu → rf2_promo_cart, not the swap", () => {
    const b = buyer({ ...old, cart: [line("Rawas", "rawas", 990, false, T("23", "10:00")), line("Bombil", "bombil", 240, true, T("22", "10:00"))] });
    expect(run(T("27", "18:00"), b, [], [FT]).template).toBe("rf2_promo_cart");
  });
  it("priority: swap beats unpaid; a seller with no live fish (or unknown) falls through to the next stage", () => {
    const b = buyer({ ...old, last_order_at: iso(T("20", "11:00")), unpaid: { id: "o1", seller_id: "nm", name: "Surmai" }, cart: [line("Rawas", "rawas", 990, false, T("23", "10:00"))] });
    expect(run(T("27", "18:00"), b, [], [FT, NOMADIC]).template).toBe("rf2_cart_swap");
    expect(run(T("27", "18:00"), b, [], [{ ...FT, live: [] } as MsgSeller, NOMADIC]).template).toBe("rf2_promo_unpaid");
    expect(run(T("27", "18:00"), { ...b, cart: [line("Rawas", "rawas", 990, false, T("23", "10:00"), "gone")] }, [], [FT, NOMADIC]).template).toBe("rf2_promo_unpaid");
    expect(run(T("27", "18:00"), { ...b, last_order_at: iso(T("23", "11:00")) }, [], [FT, NOMADIC]).template).toBe("rf2_promo_unpaid"); // cart older than the order
  });
  it("substitute: same species at the closest price, else the closest price; tie → cheaper", () => {
    const menu: MenuItem[] = [
      { name: "Surmai steaks", species: "surmai", price: 1500 }, { name: "Baby Surmai", species: "Surmai", price: 900 },
      { name: "Rawas", species: "rawas", price: 1000 }, { name: "Bangda", species: "bangda", price: 800 },
    ];
    expect(pickSubstitute({ species: "surmai", price: 1000 }, menu)?.name).toBe("Baby Surmai"); // same species beats the exact-price Rawas
    expect(pickSubstitute({ species: "pomfret", price: 1150 }, menu)?.name).toBe("Rawas");       // no pomfret: closest price
    expect(pickSubstitute({ species: "pomfret", price: 1250 }, menu)?.name).toBe("Rawas");       // Rawas and Surmai steaks both ₹250 away → cheaper
    expect(pickSubstitute({ species: "pomfret", price: 850 }, menu)?.name).toBe("Bangda");       // Bangda ₹800 and Baby Surmai ₹900 both ₹50 away → cheaper
    expect(pickSubstitute({ species: "pomfret", price: 900 }, [])).toBeNull();
  });
  it("no photo on the substitute's listing → image null", () => {
    const b = buyer({ ...old, cart: [line("Bangda", "bangda", 250, false, T("23", "10:00"))] });
    expect(run(T("27", "18:00"), b, [], [FT])).toMatchObject({ template: "rf2_cart_swap", photo: null, body: ["Priya", "Bangda", "Fishtokri", "Bombil, ₹240", "Wed 28 Oct, 8–10 AM"] });
  });
});

describe("header photo for cart and order messages (founder, 30 Oct)", () => {
  it("costliest item's own listing photo; no photo → null", () => {
    expect(costliestPhoto([{ price: 300, photo: "a" }, { price: 1200, photo: "b" }, { price: 800, photo: "c" }])).toBe("b");
    expect(costliestPhoto([{ price: 300, photo: "a" }, { price: 1200, photo: null }])).toBeNull(); // never falls back to a cheaper item
    expect(costliestPhoto([{ price: 500, photo: "a" }, { price: 500, photo: "b" }])).toBe("a");      // tie → the latest line
    expect(costliestPhoto([])).toBeNull();
  });
  it("cart promo: the costliest on-menu line of that seller; never another seller's photo", () => {
    const cart = [
      { seller_id: "ft", name: "Bombil", price: 240, photo: "https://x/bombil.jpg", on_menu: true, updated_at: iso(T("23", "10:00")) },
      { seller_id: "ft", name: "Pomfret", price: 1380, photo: "https://x/pomfret.jpg", on_menu: true, updated_at: iso(T("22", "10:00")) },
      { seller_id: "nm", name: "Halwa", price: 2000, photo: "https://x/halwa.jpg", on_menu: true, updated_at: iso(T("21", "10:00")) },
    ];
    expect(run(T("27", "18:00"), buyer({ created_at: iso(T("10", "10:00")), cart }))).toMatchObject({ template: "rf2_promo_cart", photo: "https://x/pomfret.jpg" });
    expect(run(T("27", "18:00"), buyer({ created_at: iso(T("10", "10:00")), cart: [{ ...cart[0], photo: null }] })).photo).toBeNull();
  });
  it("order messages use the order line's photo (null when its listing has none); generic with no menu photos has none", () => {
    const offer = { mode: "preorder" as const, date: "2026-10-24", when: "Sat 24 Oct, 8–10 AM" };
    const b = buyer({ unpaid: { id: "o1", seller_id: "ft", name: "Surmai", photo: "https://x/s.jpg" }, delivered: { id: "o2", seller_id: "ft", name: "Pomfret" } });
    expect(compose("promo", "unpaid", T("23", "08:30"), b, FISHTOKRI, offer)?.photo).toBe("https://x/s.jpg");
    expect(compose("promo", "again", T("23", "08:30"), b, FISHTOKRI, offer)?.photo).toBeNull();
    expect(compose("promo", "generic", T("23", "08:30"), b, FISHTOKRI, offer)?.photo).toBeNull();
  });
});

describe("generic catch promos: the seller's own photo, never stock (founder, 30 Oct)", () => {
  const LIVE: MenuItem[] = [
    { name: "Bombil", species: "bombil", price: 240, photo: "https://x/bombil.jpg", preorder: true },
    { name: "Silver Pomfret", species: "pomfret", price: 1380, photo: "https://x/pomfret.jpg", preorder: true },
    { name: "Jumbo Prawns", species: "prawns", price: 1600, photo: null, preorder: true },        // costliest pre-order item, no photo: skipped
    { name: "Surmai steaks", species: "surmai", price: 1500, photo: "https://x/surmai.jpg" },     // today only, not on the pre-order menu
  ];
  const FT = { ...FISHTOKRI, live: LIVE } as MsgSeller;
  const old = buyer({ created_at: iso(T("10", "10:00")) });
  const cartLine = (name: string, price: number, photo: string | null, on_menu: boolean, seller_id = "ft") =>
    ({ seller_id, name, price, photo, on_menu, updated_at: iso(T("08", "10:00")) }); // 15 days old: past the cart window
  const STOCK = [PROMO_IMAGE, SIGNUP_IMAGE, DEFAULT_PROMO_IMAGE];
  const isStock = (u: unknown) => typeof u === "string" && (STOCK.some((s) => u.endsWith(s)) || /\/fish\/[a-z]+\.jpg$/.test(u));

  it("rf2_catch_preorder: the costliest pre-order item with a photo", () => {
    expect(run(T("27", "18:00"), old, [], [FT])).toMatchObject({ template: "rf2_catch_preorder", photo: "https://x/pomfret.jpg" });
  });
  it("rf2_catch_prices: the costliest live item with a photo", () => {
    expect(run(T("24", "08:30"), old, [], [FT])).toMatchObject({ template: "rf2_catch_prices", photo: "https://x/surmai.jpg" });
  });
  it("skips items without a photo; none has one → null", () => {
    const noPhotos = { ...FT, live: LIVE.map((m) => ({ ...m, photo: null })) } as MsgSeller;
    expect(run(T("27", "18:00"), old, [], [noPhotos])).toMatchObject({ template: "rf2_catch_preorder", photo: null });
    expect(run(T("27", "18:00"), old, [], [{ ...FT, live: [] } as MsgSeller])).toMatchObject({ template: "rf2_catch_preorder", photo: null });
  });
  it("buyer has cart lines with that seller (any age, off-menu too): the costliest cart item's photo", () => {
    const b = buyer({ ...old, cart: [cartLine("Bombil", 240, "https://x/cart-bombil.jpg", true), cartLine("Halwa", 2200, "https://x/cart-halwa.jpg", false)] });
    expect(run(T("27", "18:00"), b, [], [FT])).toMatchObject({ template: "rf2_catch_preorder", photo: "https://x/cart-halwa.jpg" });
  });
  it("the costliest cart item has no photo → null, even when the menu has photos", () => {
    const b = buyer({ ...old, cart: [cartLine("Bombil", 240, "https://x/cart-bombil.jpg", true), cartLine("Halwa", 2200, null, false)] });
    expect(run(T("27", "18:00"), b, [], [FT])).toMatchObject({ template: "rf2_catch_preorder", photo: null });
  });
  it("another seller's cart line never lends its photo", () => {
    const offer = { mode: "preorder" as const, date: "2026-10-24", when: "Sat 24 Oct, 8–10 AM" };
    const b = buyer({ ...old, cart: [cartLine("Halwa", 2200, "https://x/nomadic-halwa.jpg", true, "nm")] });
    expect(compose("promo", "generic", T("23", "08:30"), b, FT, offer)?.photo).toBe("https://x/pomfret.jpg");
  });
  it("no stock URL in any decision, all week, any stage", () => {
    const buyers = [
      old,
      buyer({ ...old, cart: [cartLine("Bombil", 240, null, true)] }),
      buyer({ ...old, cart: [{ ...cartLine("Rawas", 990, null, true), updated_at: iso(T("22", "10:00")) }] }),
      buyer({ ...old, last_order_at: iso(T("20", "11:00")), unpaid: { id: "o1", seller_id: "ft", name: "Rawas", species: "rawas", photo: null } }),
      buyer({ ...old, last_order_at: iso(T("10", "11:00")), delivered: { id: "o2", seller_id: "ft", name: "Rawas", species: "rawas", photo: null }, last_delivered_at: iso(T("10", "12:00")) }),
    ];
    let seen = 0;
    for (const b of buyers) for (const d of ["20", "23", "24", "25", "27"]) for (const hm of ["08:30", "18:00"]) {
      for (const sellers of [[FT, NOMADIC], [{ ...FT, live: [] } as MsgSeller, NOMADIC]]) {
        const r = run(T(d, hm), b, [], sellers);
        if (r.skip) continue;
        seen++;
        expect(isStock(r.photo), `${r.template} ${d} ${hm}`).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(10);
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

describe("activity reminders (founder, 30 Oct): unpaid 30 min, cart 1 h, sign-up 1 h", () => {
  const cart = (at: number, on = true) => [{ seller_id: "ft", name: "Baby Rawas", photo: "https://x/rawas.jpg", price: 770, on_menu: on, updated_at: iso(at) }];
  const unpaid = (at: number, slot: number | null = T("24", "08:00")) => ({ id: "o1", seller_id: "ft", name: "Surmai", created_at: iso(at), slot_start: slot == null ? null : iso(slot), checkout: "c1" });
  const act = (now: number, b: BuyerState, h: SentLog[] = []) => {
    const d = decideActivity(now, b, SELLERS, h) as any;
    if (!d.skip && d.template) expect(d.body, d.template).toHaveLength(varCount(d.template));
    return d;
  };
  const sent = (kind: string, ms: number, key: string, status = "sent"): SentLog => ({ ...log(kind, ms), status, dedupe_key: `${key}:whatsapp` });

  it("unpaid: due 30 min after checkout, not at 29 min, once per checkout", () => {
    const b = buyer({ created_at: iso(T("23", "09:00")), unpaid: unpaid(T("23", "10:00")), last_order_at: iso(T("23", "10:00")) });
    expect(act(T("23", "10:29"), b).skip).toBeTruthy();
    expect(act(T("23", "10:30"), b)).toMatchObject({ kind: "act_unpaid", dedupe_key: "act_unpaid:c1", order_id: "o1" });
    expect(act(T("23", "10:40"), b, [sent("act_unpaid", T("23", "10:30"), "act_unpaid:c1")]).kind).not.toBe("act_unpaid");
    // a failed WhatsApp still counts as reminded (the SMS fallback handles it, never a second WhatsApp)
    expect(act(T("23", "10:40"), b, [sent("act_unpaid", T("23", "10:30"), "act_unpaid:c1", "failed")]).kind).not.toBe("act_unpaid");
  });
  it("unpaid: not when the slot has started", () => {
    const b = buyer({ unpaid: unpaid(T("24", "07:00"), T("24", "08:00")), last_order_at: iso(T("24", "07:00")) });
    expect(act(T("24", "08:10"), b).kind).not.toBe("act_unpaid");
  });
  it("cart: due 1 h after the last change, rf2_cart_today with the cart's fish, photo and SMS vars", () => {
    const b = buyer({ created_at: iso(T("22", "09:00")), cart: cart(T("23", "10:15")) });
    expect(act(T("23", "11:14"), b).skip).toBe("nothing due");
    expect(act(T("23", "11:15"), b)).toMatchObject({
      kind: "act_cart", template: "rf2_cart_today", dedupe_key: "act_cart:b:2026-10-23", photo: "https://x/rawas.jpg", path: "/s/fishtokri",
      body: ["Priya", "Baby Rawas", "Fishtokri", "today, 12–2 PM"], sms: { key: "CART", vars: ["Priya", "Baby Rawas", "Fishtokri", "today, 12–2 PM"] },
    });
  });
  it("cart: no reminder when an order came after it, or nothing is on the menu", () => {
    expect(act(T("23", "11:15"), buyer({ cart: cart(T("23", "10:15")), last_order_at: iso(T("23", "10:30")) })).kind).toBeUndefined();
    expect(act(T("23", "11:15"), buyer({ cart: cart(T("23", "10:15"), false) })).kind).toBeUndefined();
  });
  it("sign-up: 1 h after, only with no cart and no order; rf2_welcome to the nearest seller", () => {
    const b = buyer({ created_at: iso(T("23", "10:00")) });
    expect(act(T("23", "10:59"), b).skip).toBe("nothing due");
    expect(act(T("23", "11:00"), b)).toMatchObject({ kind: "act_signup", template: "rf2_welcome", dedupe_key: "act_signup:b", body: ["Priya", "you", "today, 12–2 PM"], sms: { key: "SIGNUP", vars: ["Priya", "Fishtokri"] } });
    expect(act(T("23", "11:00"), buyer({ created_at: iso(T("23", "10:00")), last_order_at: iso(T("23", "10:20")) })).kind).toBeUndefined();
  });
  it("priority unpaid > cart > sign-up, and at most one cart/sign-up reminder a day", () => {
    const both = buyer({ created_at: iso(T("23", "09:00")), cart: cart(T("23", "09:30")), unpaid: unpaid(T("23", "09:00")), last_order_at: iso(T("23", "09:00")) });
    expect(act(T("23", "10:31"), both).kind).toBe("act_unpaid");
    const signedThenCart = buyer({ created_at: iso(T("23", "09:00")), cart: cart(T("23", "11:00")) });
    expect(act(T("23", "12:00"), signedThenCart, [sent("act_signup", T("23", "10:00"), "act_signup:b")]).skip).toBe("cart already reminded");
  });
  it("night: an action after 8 PM is reminded 8–9 AM next day if still true; never 9 PM–8 AM", () => {
    const b = buyer({ created_at: iso(T("22", "09:00")), cart: cart(T("23", "20:30")) });
    expect(act(T("23", "21:30"), b).skip).toBe("quiet hours");
    expect(act(T("24", "07:50"), b).skip).toBe("quiet hours");
    expect(act(T("24", "08:00"), b)).toMatchObject({ kind: "act_cart", dedupe_key: "act_cart:b:2026-10-23" });
    expect(act(T("24", "09:10"), b).skip).toBe("nothing due");
    expect(reminderWindow(T("23", "20:30"), T("23", "20:40"))).toBe(true);
    expect(reminderWindow(T("23", "22:00"), T("24", "08:05"))).toBe(true);
    expect(reminderWindow(T("23", "22:00"), T("24", "10:05"))).toBe(false);
  });
  it("every unpaid checkout gets its own reminder, oldest first", () => {
    const u1 = { ...unpaid(T("23", "10:00")), id: "o1", checkout: "c1" };
    const u2 = { ...unpaid(T("23", "10:10")), id: "o2", checkout: "c2" };
    const b = buyer({ unpaids: [u1, u2], unpaid: u2, last_order_at: iso(T("23", "10:10")) });
    expect(act(T("23", "10:41"), b)).toMatchObject({ dedupe_key: "act_unpaid:c1" });
    expect(act(T("23", "10:51"), b, [sent("act_unpaid", T("23", "10:41"), "act_unpaid:c1")])).toMatchObject({ dedupe_key: "act_unpaid:c2" });
  });
  it("a cart with two sellers names only the latest seller's fish", () => {
    const b = buyer({ cart: [
      { seller_id: "ft", name: "Surmai", on_menu: true, updated_at: iso(T("23", "10:15")) },
      { seller_id: "nm", name: "Halwa", on_menu: true, updated_at: iso(T("23", "09:00")) }] });
    expect(act(T("23", "11:15"), b)).toMatchObject({ body: ["Priya", "Surmai", "Fishtokri", "today, 12–2 PM"], path: "/s/fishtokri" });
  });
  it("DND and STOP get no reminders", () => {
    expect(act(T("23", "11:15"), buyer({ cart: cart(T("23", "10:15")), dnd: true })).skip).toBe("do not message");
    expect(act(T("23", "11:15"), buyer({ cart: cart(T("23", "10:15")), opted_out: true })).skip).toBe("opted out");
  });
});

describe("promo spacing (founder, 30 Oct)", () => {
  const b = () => buyer({ created_at: iso(T("10", "10:00")), cart: [{ seller_id: "ft", name: "Baby Rawas", on_menu: true, updated_at: iso(T("22", "10:00")) }] });
  it("no promo within 48 h of an activity reminder; allowed after", () => {
    expect(run(T("24", "08:30"), b(), [{ ...log("act_cart", T("22", "11:00")), status: "sent" }]).skip).toBe("activity reminder <48h");
    expect(run(T("25", "08:30"), b(), [{ ...log("act_cart", T("22", "11:00")), status: "sent" }]).template).toBe("rf2_promo_cart");
  });
  it("a failed reminder doesn't block a promo", () => {
    expect(run(T("24", "08:30"), b(), [{ ...log("act_cart", T("23", "11:00")), status: "failed", error: "Message undeliverable" }]).template).toBe("rf2_promo_cart");
  });
  it("Meta blocked a promo → no promo to that buyer for 3 days (wait, don't retry)", () => {
    const blocked = { ...log("promo", T("23", "08:30")), status: "failed", error: "Message undeliverable as Meta has restricted it for higher quality messaging - retry again in a few days" };
    expect(run(T("24", "08:30"), b(), [blocked]).skip).toBe("meta limit: waiting");
    expect(run(T("25", "08:30"), b(), [blocked]).skip).toBe("meta limit: waiting");
    expect(run(T("27", "18:00"), b(), [blocked]).template).toBe("rf2_promo_cart");
  });
  it("DND gets no promo", () => {
    expect(run(T("24", "08:30"), { ...b(), dnd: true }).skip).toBe("do not message");
  });
});

describe("promo now (founder's extra run)", () => {
  it("sends outside a slot but keeps every other rule", () => {
    const b = buyer({ created_at: iso(T("22", "10:00")) });
    expect(decide(T("23", "19:40"), b, SELLERS, []).skip).toBe("nothing due");
    expect(decide(T("23", "19:40"), b, SELLERS, [], true)).toMatchObject({ kind: "promo", template: "rf2_catch_preorder" });
    expect((decide(T("23", "19:40"), b, SELLERS, [{ ...log("promo", T("23", "08:30")), status: "read" }], true) as any).skip).toBe("already messaged today");
    expect((decide(T("23", "21:10"), b, SELLERS, [], true) as any).skip).toBe("quiet hours");
  });
});

describe("send to all (founder's one-off)", () => {
  it("skips gaps and holds but keeps opt-out, DND and 1 a day", () => {
    const b = buyer({ created_at: iso(T("10", "10:00")) }); // inactive > 30 days
    const blocked = { ...log("promo", T("23", "09:04")), status: "failed", error: "Message undeliverable as Meta has restricted it for higher quality messaging" };
    const yesterday = { ...log("promo", T("23", "09:04")), status: "read" };
    expect(decide(T("24", "09:15"), b, SELLERS, [blocked], true).skip).toBeTruthy();
    expect(decide(T("24", "09:15"), b, SELLERS, [blocked], true, true)).toMatchObject({ kind: "promo" });
    expect(decide(T("24", "09:15"), b, SELLERS, [yesterday], true, true)).toMatchObject({ kind: "promo" });
    expect((decide(T("24", "09:15"), b, SELLERS, [{ ...log("promo", T("24", "08:30")), status: "read" }], true, true) as any).skip).toBe("already messaged today");
    expect((decide(T("24", "09:15"), { ...b, dnd: true }, SELLERS, [], true, true) as any).skip).toBe("do not message");
    expect((decide(T("24", "09:15"), { ...b, opted_out: true }, SELLERS, [], true, true) as any).skip).toBe("opted out");
  });
});
