import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * /api/seller/orders for a multi-item cart (one checkout = N order rows sharing
 * cart_id) against an in-memory database: cart-level transitions move every live
 * row with ONE notification, an item cancel refunds and announces just that item,
 * and old single rows behave as before.
 */

type Row = Record<string, any>;
const db: Record<string, Row[]> = { sellers: [], fish_listings: [], orders: [], buyers: [], razorpay_payments: [] };

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "update" = "select";
  let payload: Row | null = null;
  let order: string | null = null;
  let range: [number, number] | null = null;
  const run = () => {
    let hit = db[table].filter((r) => filters.every((f) => f(r)));
    if (op === "update") hit.forEach((r) => Object.assign(r, payload));
    if (order) hit = [...hit].sort((a, b) => String(a[order!]).localeCompare(String(b[order!])));
    return range ? hit.slice(range[0], range[1] + 1) : hit;
  };
  const q: any = {
    select: () => q,
    update: (p: Row) => { op = "update"; payload = p; return q; },
    eq: (k: string, v: any) => { filters.push((r) => r[k] === v); return q; },
    in: (k: string, vs: any[]) => { filters.push((r) => vs.includes(r[k])); return q; },
    gte: () => q,
    not: () => q,
    order: (k: string) => { order = k; return q; },
    range: (a: number, b: number) => { range = [a, b]; return q; },
    limit: () => q,
    single: async () => { const d = run()[0]; return d ? { data: d, error: null } : { data: null, error: { message: "not found" } }; },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve().then(() => { const d = run(); return { data: d, count: d.length, error: null }; }).then(res, rej),
  };
  return q;
}
const fake = { from: (t: string) => query(t), rpc: async () => ({ data: null, error: null }) };

const push = vi.fn(async (_p: any) => ({ ok: true, sent: true }));
const email = vi.fn(async (_to: string, _subject: string, _html: string) => "sent");
const refund = vi.fn(async (_sb: any, _o: any, _c: any) => ({ ok: true, refundId: "rfnd_1", note: "Refunded" }));
const notify = vi.fn(async (_o: any) => ({}));

vi.mock("@supabase/supabase-js", () => ({ createClient: () => fake }));
vi.mock("../../src/lib/server/assert-seller", () => ({ assertSellerOwns: async () => ({ ok: true }) }));
vi.mock("../../src/lib/server/buyer-push", () => ({ sendBuyerOrderPush: (p: any) => push(p) }));
vi.mock("../../src/lib/server/send-email", () => ({ sendTransactionalEmail: (to: string, s: string, h: string) => email(to, s, h) }));
vi.mock("../../src/lib/server/razorpay-ledger", () => ({ refundOrderRazorpay: (sb: any, o: any, c: any) => refund(sb, o, c) }));
vi.mock("../../src/lib/server/notify-order-parties", () => ({ notifyOrderParties: (o: any) => notify(o) }));

const { POST, GET } = await import("../../src/pages/api/seller/orders");
const { buyerOrderPushNotification } = await import("../../src/lib/server/buyer-order-push-copy");

function row(id: string, over: Row = {}): Row {
  return {
    id, cart_id: "cart1", listing_id: "l1", buyer_id: "b1", buyer_phone: "9876543210",
    status: "paid", order_type: "delivery", payment_method: "razorpay",
    razorpay_payment_id: "pay_1", razorpay_order_id: "order_1",
    total_price: 600, delivery_fee: 0, paid_amount: 600, quantity: 1, quantity_unit: "kg",
    created_at: `2026-10-15T08:00:0${id.slice(-1)}Z`, ...over,
  };
}

async function post(body: Row) {
  const res = await POST({
    request: new Request("http://x/api/seller/orders", { method: "POST", body: JSON.stringify({ seller_id: "s1", ...body }) }),
    url: new URL("http://x/api/seller/orders"),
  } as any);
  return { status: res.status, data: await res.json() };
}
const statusOf = (id: string) => db.orders.find((o) => o.id === id)!.status;

beforeEach(() => {
  for (const k of Object.keys(db)) db[k] = [];
  db.sellers.push({ id: "s1", email: "seller@x.in" });
  db.buyers.push({ id: "b1", email: "buyer@x.in" });
  db.fish_listings.push({ id: "l1", seller_id: "s1" }, { id: "l2", seller_id: "s1" }, { id: "lx", seller_id: "s2" });
  db.orders.push(
    row("o1", { species: "pomfret", delivery_fee: 40, paid_amount: 640 }),
    row("o2", { species: "surmai", listing_id: "l2", total_price: 120, paid_amount: 120 }),
    row("o3", { species: "prawns", status: "cancelled" }),
  );
  [push, email, refund, notify].forEach((f) => f.mockClear());
});

describe("cart-level transitions", () => {
  it("confirm moves every live row, skips the closed one, notifies once", async () => {
    const { status, data } = await post({ order_id: "o2", status: "confirmed", cart: true });
    expect(status).toBe(200);
    expect(data.orders.map((o: Row) => o.id)).toEqual(["o1", "o2"]);
    expect([statusOf("o1"), statusOf("o2"), statusOf("o3")]).toEqual(["confirmed", "confirmed", "cancelled"]);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toMatchObject({ status: "confirmed", species: "Pomfret + Surmai" });
    expect(email).toHaveBeenCalledTimes(2); // one buyer + one seller
    expect(email.mock.calls[0][1]).toBe("Order Confirmed — Pomfret + Surmai");
    expect(email.mock.calls[0][2]).toContain("Surmai");
    expect(email.mock.calls[0][2]).toContain("₹760"); // 600 + 120 + 40 delivery
  });

  it("a row the seller does not own is never touched", async () => {
    db.orders.push(row("o4", { listing_id: "lx", species: "crab" }));
    await post({ order_id: "o1", status: "confirmed", cart: true });
    expect(statusOf("o4")).toBe("paid");
  });

  it("nothing can move → the same error as a single row", async () => {
    db.orders.forEach((o) => (o.status = "completed"));
    const { status, data } = await post({ order_id: "o1", status: "confirmed", cart: true });
    expect(status).toBe(400);
    expect(data.error).toBe("Cannot change from completed to confirmed");
  });

  it("whole-order cancel refunds every live row and sends one notification", async () => {
    const { status } = await post({ order_id: "o1", status: "cancelled", cart: true, cancel_reason: "Boat did not go out" });
    expect(status).toBe(200);
    expect([statusOf("o1"), statusOf("o2")]).toEqual(["cancelled", "cancelled"]);
    expect(refund.mock.calls.map((c) => c[1].id)).toEqual(["o1", "o2"]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ event: "cancelled_by_seller", order_ids: ["o1", "o2"] });
    expect(push).not.toHaveBeenCalled();
  });
});

describe("item-level cancel", () => {
  it("cancels and refunds only that row; the buyer hears which item, why and how much", async () => {
    const { status } = await post({ order_id: "o2", status: "cancelled", cancel_reason: "Surmai sold out" });
    expect(status).toBe(200);
    expect([statusOf("o1"), statusOf("o2")]).toEqual(["paid", "cancelled"]);
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund.mock.calls[0][1].id).toBe("o2");
    expect(notify).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(1);
    const p = push.mock.calls[0][0];
    expect(p.cancel.item).toEqual({ order_short: "O1", amount: 120 });
    const copy = buyerOrderPushNotification(p.status, p.species, null, p.cancel);
    expect(copy.body).toBe("Surmai was removed from your order #O1 — ₹120 refunded. Reason: Surmai sold out.");
    expect(email).toHaveBeenCalledTimes(1);
    expect(email.mock.calls[0][1]).toBe("Surmai was removed from your order #O1 — ₹120 refunded");
  });

  it("cancelling the last live item is a whole-order cancel", async () => {
    db.orders.find((o) => o.id === "o1")!.status = "cancelled";
    await post({ order_id: "o2", status: "cancelled", cancel_reason: "Sold out" });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ order_id: "o2", event: "cancelled_by_seller" });
  });
});

describe("single-item orders are unchanged", () => {
  beforeEach(() => {
    db.orders = [row("solo", { cart_id: null, species: "pomfret", delivery_fee: 40, paid_amount: 640 })];
  });

  it("confirm: one push with the species, emails for the one row", async () => {
    const { status, data } = await post({ order_id: "solo", status: "confirmed" });
    expect(status).toBe(200);
    expect(data.order.status).toBe("confirmed");
    expect(push.mock.calls[0][0]).toMatchObject({ species: "pomfret", order_id: "solo" });
    expect(email.mock.calls[0][1]).toBe("Order Confirmed — Pomfret");
  });

  it("cart: true on a row without a cart only moves that row", async () => {
    const { status } = await post({ order_id: "solo", status: "confirmed", cart: true });
    expect(status).toBe(200);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("cancel goes through the shared notifier with a full refund", async () => {
    await post({ order_id: "solo", status: "cancelled", cancel_reason: "Sold out" });
    expect(refund).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ order_id: "solo", event: "cancelled_by_seller", order_ids: ["solo"] });
  });
});

describe("GET groups a cart into one card", () => {
  it("returns the cart once with every row as cart_items", async () => {
    db.orders.push(row("solo", { cart_id: null, created_at: "2026-10-15T07:00:00Z" }));
    const res = await GET({
      url: new URL("http://x/api/seller/orders?seller_id=s1&tab=pending"),
      request: new Request("http://x"),
    } as any);
    const { orders, total, counts } = await res.json();
    const cart = orders.find((o: Row) => o.cart_items);
    expect(orders).toHaveLength(2);
    // Badges and pages count orders (one per cart), not item rows.
    expect(total).toBe(2);
    expect(counts.pending).toBe(orders.filter((o: Row) => ["pending", "pending_payment", "paid", "pre_order", "scheduled"].includes(o.status)).length);
    expect(cart.id).toBe("o1");
    expect(cart.cart_items.map((r: Row) => r.id)).toEqual(["o1", "o2", "o3"]);
    expect(orders.find((o: Row) => o.id === "solo").cart_items).toBeUndefined();
  });
});
