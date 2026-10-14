import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * POST /api/orders/create-seller-cart against an in-memory database.
 *
 * Pins the checkout matrix: seller fulfilment (pickup / delivery / both) ×
 * same-day / pre-order, listing switches, stock shared across price tiers,
 * stale pages, and what each order row is charged (what Razorpay will bill).
 * Oct 14: a delivery-only seller's pre-orders all failed "does not offer pickup".
 */

type Row = Record<string, any>;
const db: Record<string, Row[]> = { sellers: [], fish_listings: [], orders: [], buyer_addresses: [], buyers: [] };
let rpcFailOnCall = 0;
let rpcCalls = 0;

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "update" = "select";
  let payload: Row | null = null;
  const rows = () => db[table].filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (op === "insert") {
      const row = { id: `ord_${db.orders.length + 1}`, created_at: new Date().toISOString(), ...payload };
      db[table].push(row);
      return [row];
    }
    if (op === "update") {
      const hit = rows();
      hit.forEach((r) => Object.assign(r, payload));
      return hit;
    }
    return rows();
  };
  const q: any = {
    select: () => q,
    insert: (p: Row) => { op = "insert"; payload = p; return q; },
    update: (p: Row) => { op = "update"; payload = p; return q; },
    eq: (k: string, v: any) => { filters.push((r) => r[k] === v); return q; },
    in: (k: string, vs: any[]) => { filters.push((r) => vs.includes(r[k])); return q; },
    gte: (k: string, v: any) => { filters.push((r) => r[k] >= v); return q; },
    single: async () => { const d = run()[0]; return d ? { data: d, error: null } : { data: null, error: { message: "not found" } }; },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: run(), error: null }).then(res, rej),
  };
  return q;
}

const fake = {
  from: (t: string) => query(t),
  rpc: async (_fn: string, p: Row) => {
    rpcCalls++;
    if (rpcFailOnCall && rpcCalls === rpcFailOnCall) return { data: null, error: { message: "Only 0 kg in stock" } };
    const row = {
      id: `ord_${db.orders.length + 1}`, listing_id: p.p_listing_id, quantity: p.p_quantity, quantity_unit: p.p_quantity_unit,
      buyer_phone: p.p_buyer_phone, buyer_id: p.p_buyer_id, total_price: p.p_total_price, delivery_fee: p.p_delivery_fee,
      status: p.p_status, order_type: p.p_order_type, paid_amount: p.p_total_price + p.p_delivery_fee,
      pricing_option_id: p.p_pricing_option_id, created_at: new Date().toISOString(),
    };
    db.orders.push(row);
    return { data: row.id, error: null };
  },
};

vi.mock("@supabase/supabase-js", () => ({ createClient: () => fake }));
vi.mock("../../src/lib/server/buyer-push", () => ({ sendBuyerOrderPush: async () => {} }));
vi.mock("../../src/lib/server/send-email", () => ({ sendTransactionalEmail: async () => {} }));

const { POST } = await import("../../src/pages/api/orders/create-seller-cart");

const IST = 5.5 * 3600_000;
const SAME_DAY = Date.UTC(2024, 0, 15, 9, 0) - IST; // Mon 09:00 IST
const PREORDER = Date.UTC(2024, 0, 15, 18, 0) - IST; // Mon 18:00 IST
const AFTER_CUTOFF = Date.UTC(2024, 0, 15, 22, 30) - IST;

const ALL = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
function seller(over: Row = {}): Row {
  return {
    id: "s1", is_active: true, opens_at: "06:00", closes_at: "14:00", accepts_preorder: true,
    open_days: ALL, preorder_days: ALL, preorder_cutoff_time: "22:00",
    has_pickup: true, has_delivery: true, min_order_amount: 0,
    delivery_fee_enabled: true, delivery_fee_type: "fixed", delivery_fee_amount: 40, delivery_fee_per_km: 0,
    free_delivery_above: 0, delivery_rad: 0, lat: null, lng: null, ...over,
  };
}
function listing(over: Row = {}): Row {
  return {
    id: "l1", seller_id: "s1", species: "pomfret", weight_avail: 5, is_available: true,
    is_preorder_enabled: true, is_order_paused: false, buyer_daily_qty_limit: null, oos_threshold: null, deleted_at: null,
    pricing_options: [
      { id: "opt_0", label: "Per kg", price: 600, unit: "kg", bundle_size: 1, preorder_price_min: 500, preorder_price_max: 700 },
      { id: "opt_1", label: "Half kg", price: 320, unit: "kg", bundle_size: 0.5, preorder_price_min: 260, preorder_price_max: 360 },
    ],
    ...over,
  };
}

async function place(body: Row) {
  const res = await POST({
    request: new Request("http://x/api/orders/create-seller-cart", { method: "POST", body: JSON.stringify(body) }),
    url: new URL("http://x/api/orders/create-seller-cart"),
  } as any);
  return { status: res.status, data: await res.json() };
}
const cart = (over: Row = {}) => ({
  seller_id: "s1",
  buyer_phone: "9876543210",
  buyer_addr: "Flat 4, Sea View",
  lines: [{ listing_id: "l1", quantity: 1, pricing_option_id: "opt_0" }],
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(db)) db[k] = [];
  rpcCalls = 0;
  rpcFailOnCall = 0;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fulfilment × placement matrix", () => {
  const cases: [string, Row, number, string, number][] = [
    // label, seller flags, time, order_type, expected status
    ["delivery-only, pre-order, delivery", { has_pickup: false }, PREORDER, "delivery", 201],
    ["delivery-only, pre-order, pickup", { has_pickup: false }, PREORDER, "pickup", 400],
    ["delivery-only, same-day, delivery", { has_pickup: false }, SAME_DAY, "delivery", 201],
    ["delivery-only, same-day, pickup", { has_pickup: false }, SAME_DAY, "pickup", 400],
    ["pickup-only, pre-order, pickup", { has_delivery: false }, PREORDER, "pickup", 201],
    ["pickup-only, pre-order, delivery", { has_delivery: false }, PREORDER, "delivery", 400],
    ["pickup-only, same-day, delivery", { has_delivery: false }, SAME_DAY, "delivery", 400],
    ["both, pre-order, delivery", {}, PREORDER, "delivery", 201],
    ["both, pre-order, pickup", {}, PREORDER, "pickup", 201],
    ["both, same-day, delivery", {}, SAME_DAY, "delivery", 201],
    ["both, same-day, pickup", {}, SAME_DAY, "pickup", 201],
    ["has_delivery null, same-day, delivery", { has_delivery: null }, SAME_DAY, "delivery", 400],
    ["has_pickup null, same-day, pickup", { has_pickup: null }, SAME_DAY, "pickup", 201],
  ];
  it.each(cases)("%s → %i", async (_label, flags, now, order_type, want) => {
    vi.setSystemTime(now);
    db.sellers.push(seller(flags));
    db.fish_listings.push(listing());
    const { status, data } = await place(cart({ order_type }));
    expect(status, JSON.stringify(data)).toBe(want);
    if (want === 201) {
      expect(data.orders[0].order_type).toBe(order_type);
      expect(data.placement_kind).toBe(now === PREORDER ? "preorder" : "same_day");
    }
  });

  it("after the pre-order cutoff the cart is refused with the cutoff message", async () => {
    vi.setSystemTime(AFTER_CUTOFF);
    db.sellers.push(seller());
    db.fish_listings.push(listing());
    const { status, data } = await place(cart({ order_type: "pickup" }));
    expect(status).toBe(400);
    expect(data.error).toContain("cutoff");
  });
});

describe("amount charged = what Razorpay bills (total_price + delivery_fee)", () => {
  it("same-day: tier price × packs, delivery fee once on the first row", async () => {
    vi.setSystemTime(SAME_DAY);
    db.sellers.push(seller());
    db.fish_listings.push(listing({ weight_avail: 10 }));
    const { status, data } = await place(cart({
      order_type: "delivery",
      lines: [
        { listing_id: "l1", quantity: 2, pricing_option_id: "opt_0" },
        { listing_id: "l1", quantity: 1.5, pricing_option_id: "opt_1" },
      ],
    }));
    expect(status).toBe(201);
    expect(data.orders.map((o: Row) => o.total_price)).toEqual([1200, 960]);
    expect(data.orders.map((o: Row) => o.delivery_fee)).toEqual([40, 0]);
  });

  it("pre-order: charges the top of the range per pack, plus delivery", async () => {
    vi.setSystemTime(PREORDER);
    db.sellers.push(seller());
    db.fish_listings.push(listing());
    const { data } = await place(cart({
      order_type: "delivery",
      lines: [{ listing_id: "l1", quantity: 1, pricing_option_id: "opt_1" }],
    }));
    const o = data.orders[0];
    expect(o.total_price).toBe(720); // 2 half-kg packs × ₹360 max
    expect(o.delivery_fee).toBe(40);
    expect(o.paid_amount).toBe(760);
    expect(o.is_preorder).toBe(true);
  });

  it("pickup never carries a delivery fee; free_delivery_above uses the whole cart", async () => {
    vi.setSystemTime(SAME_DAY);
    db.sellers.push(seller({ free_delivery_above: 1000 }));
    db.fish_listings.push(listing());
    const pick = await place(cart({ order_type: "pickup" }));
    expect(pick.data.orders[0].delivery_fee).toBe(0);
    const big = await place(cart({ order_type: "delivery", lines: [{ listing_id: "l1", quantity: 2, pricing_option_id: "opt_0" }] }));
    expect(big.data.orders[0].delivery_fee).toBe(0);
  });

  it("min_order_amount is checked on the cart subtotal", async () => {
    vi.setSystemTime(SAME_DAY);
    db.sellers.push(seller({ min_order_amount: 1000 }));
    db.fish_listings.push(listing());
    const { status, data } = await place(cart({ order_type: "pickup" }));
    expect(status).toBe(400);
    expect(data.error).toContain("Minimum order");
  });
});

describe("listing switches", () => {
  it("'Pause same-day orders' does not block pre-orders", async () => {
    vi.setSystemTime(PREORDER);
    db.sellers.push(seller());
    db.fish_listings.push(listing({ is_order_paused: true, is_available: false, weight_avail: 0 }));
    expect((await place(cart({ order_type: "pickup" }))).status).toBe(201);
  });

  it("'Pause same-day orders' blocks same-day", async () => {
    vi.setSystemTime(SAME_DAY);
    db.sellers.push(seller());
    db.fish_listings.push(listing({ is_order_paused: true }));
    expect((await place(cart({ order_type: "pickup" }))).status).toBe(400);
  });

  it("pre-order of an item with pre-orders off is refused", async () => {
    vi.setSystemTime(PREORDER);
    db.sellers.push(seller());
    db.fish_listings.push(listing({ is_preorder_enabled: false }));
    expect((await place(cart({ order_type: "pickup" }))).status).toBe(400);
  });

  it("same-day stock is shared by every price tier of a listing", async () => {
    vi.setSystemTime(SAME_DAY);
    db.sellers.push(seller());
    db.fish_listings.push(listing({ weight_avail: 2 }));
    const lines = [
      { listing_id: "l1", quantity: 2, pricing_option_id: "opt_0" },
      { listing_id: "l1", quantity: 1, pricing_option_id: "opt_1" },
    ];
    const { status, data } = await place(cart({ order_type: "pickup", lines }));
    expect(status).toBe(400);
    expect(data.error).toContain("in stock");
    expect(db.orders).toHaveLength(0);
  });

  it("pre-orders ignore today's stock", async () => {
    vi.setSystemTime(PREORDER);
    db.sellers.push(seller());
    db.fish_listings.push(listing({ weight_avail: 0, is_available: false }));
    const { status } = await place(cart({ order_type: "pickup", lines: [{ listing_id: "l1", quantity: 3, pricing_option_id: "opt_0" }] }));
    expect(status).toBe(201);
  });

  it("per-buyer daily limit counts every tier in the cart", async () => {
    vi.setSystemTime(SAME_DAY);
    db.sellers.push(seller());
    db.fish_listings.push(listing({ weight_avail: 10, buyer_daily_qty_limit: 2 }));
    const lines = [
      { listing_id: "l1", quantity: 2, pricing_option_id: "opt_0" },
      { listing_id: "l1", quantity: 0.5, pricing_option_id: "opt_1" },
    ];
    const { status, data } = await place(cart({ order_type: "pickup", lines }));
    expect(status).toBe(400);
    expect(data.error).toContain("Daily limit");
  });
});

describe("stale page and partial failures", () => {
  it("page loaded same-day, placed after close → 409, nothing written", async () => {
    vi.setSystemTime(PREORDER);
    db.sellers.push(seller());
    db.fish_listings.push(listing());
    const { status, data } = await place(cart({ order_type: "pickup", placement_kind: "same_day" }));
    expect(status).toBe(409);
    expect(data.code).toBe("placement_changed");
    expect(db.orders).toHaveLength(0);
  });

  it("matching placement_kind is accepted", async () => {
    vi.setSystemTime(PREORDER);
    db.sellers.push(seller());
    db.fish_listings.push(listing());
    expect((await place(cart({ order_type: "pickup", placement_kind: "preorder" }))).status).toBe(201);
  });

  it("delivery without an address is refused", async () => {
    vi.setSystemTime(SAME_DAY);
    db.sellers.push(seller());
    db.fish_listings.push(listing());
    const { status } = await place(cart({ order_type: "delivery", buyer_addr: null }));
    expect(status).toBe(400);
  });

  it("a later line failing cancels the rows already written", async () => {
    vi.setSystemTime(SAME_DAY);
    db.sellers.push(seller());
    db.fish_listings.push(listing({ weight_avail: 10 }), listing({ id: "l2", weight_avail: 10 }));
    rpcFailOnCall = 2;
    const { status } = await place(cart({
      order_type: "pickup",
      lines: [
        { listing_id: "l1", quantity: 1, pricing_option_id: "opt_0" },
        { listing_id: "l2", quantity: 1, pricing_option_id: "opt_0" },
      ],
    }));
    expect(status).toBe(400);
    expect(db.orders).toHaveLength(1);
    expect(db.orders[0].status).toBe("cancelled");
    expect(db.orders[0].cancelled_by).toBe("system");
  });
});
