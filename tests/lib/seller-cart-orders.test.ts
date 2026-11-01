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
    is: (k: string, v: any) => { filters.push((r) => (r[k] ?? null) === v); return q; },
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
const wa = vi.fn(async (_id: string, _event: string, _cancel?: any) => {});

vi.mock("@supabase/supabase-js", () => ({ createClient: () => fake }));
vi.mock("../../src/lib/server/assert-seller", () => ({ assertSellerOwns: async () => ({ ok: true }) }));
vi.mock("../../src/lib/server/buyer-push", () => ({ sendBuyerOrderPush: (p: any) => push(p) }));
vi.mock("../../src/lib/server/send-email", () => ({ sendTransactionalEmail: (to: string, s: string, h: string) => email(to, s, h) }));
vi.mock("../../src/lib/server/razorpay-ledger", () => ({ refundOrderRazorpay: (sb: any, o: any, c: any) => refund(sb, o, c) }));
vi.mock("../../src/lib/server/notify-order-parties", () => ({ notifyOrderParties: (o: any) => notify(o) }));
vi.mock("../../src/lib/server/notify-order-whatsapp", () => ({ notifyOrderWhatsApp: (id: string, e: string, c?: any) => wa(id, e, c) }));

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
  [push, email, refund, notify, wa].forEach((f) => f.mockClear());
  refund.mockImplementation(async () => ({ ok: true, refundId: "rfnd_1", note: "Refunded" }));
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
    expect(email.mock.calls[0][1]).toBe("Your Relifish order is confirmed"); // founder, 26 Oct
    expect(email.mock.calls[0][2]).toContain("Pomfret + Surmai, cleaned and cut your way"); // preview line
    expect(email.mock.calls[0][2]).toContain("Surmai");
    expect(email.mock.calls[0][2]).toContain("₹760"); // 600 + 120 + 40 delivery
  });

  it("confirm copy lists only live items, and the kept delivery fee", async () => {
    // Pomfret (carried the ₹40 fee) was removed after payment; Surmai + Prawns go ahead.
    db.orders.find((o) => o.id === "o1")!.status = "cancelled";
    db.orders.find((o) => o.id === "o3")!.status = "paid";
    await post({ order_id: "o2", status: "confirmed", cart: true });
    expect(push.mock.calls[0][0].species).toBe("Surmai + Prawns");
    const html = email.mock.calls[0][2];
    expect(html).not.toMatch(/pomfret/i);
    expect(html).toContain("₹760"); // 120 + 600 + 40 delivery
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
    expect(p.cancel.item).toEqual({ order_short: "O1", amount: 120, sent: true });
    const copy = buyerOrderPushNotification(p.status, p.species, null, p.cancel);
    expect(copy.body).toBe("Surmai was removed from your order #O1 — ₹120 refunded. Reason: Surmai sold out.");
    expect(email).toHaveBeenCalledTimes(1);
    expect(email.mock.calls[0][1]).toBe("Sorry, Surmai was removed from your order #O1 — ₹120 refunded");
    // WhatsApp rf2_cancelled about the removed row, under the cart's order number.
    expect(wa).toHaveBeenCalledTimes(1);
    expect(wa.mock.calls[0]).toEqual(["o2", "cancelled", { reason: "Surmai sold out", refund: "₹120 refunded", removedFrom: "o1" }]);
  });

  it("a FAILED refund is never announced as refunded (30 Oct incident)", async () => {
    refund.mockImplementation(async () => ({ ok: false, refundId: null, note: "Razorpay refund FAILED (400): not enough credits" }));
    await post({ order_id: "o2", status: "cancelled", cancel_reason: "Not available" });
    const o2 = db.orders.find((o) => o.id === "o2")!;
    expect(o2.refund_sent_at ?? null).toBeNull();
    const pending = "₹120 refund is being processed, it reaches you in 5–7 working days";
    const p = push.mock.calls[0][0];
    expect(buyerOrderPushNotification(p.status, p.species, null, p.cancel).body).toBe(`Surmai was removed from your order #O1 — ${pending}. Reason: Not available.`);
    expect(email.mock.calls[0][1]).toBe(`Sorry, Surmai was removed from your order #O1 — ${pending}`);
    expect(email.mock.calls[0][1]).not.toMatch(/₹120 refunded/);
    expect(wa.mock.calls[0][2]).toMatchObject({ refund: pending, removedFrom: "o1" });
  });

  it("removing the item that carried the delivery fee refunds its price only; the email still bills the fee", async () => {
    await post({ order_id: "o1", status: "cancelled", cancel_reason: "Pomfret sold out" });
    expect(push.mock.calls[0][0].cancel.item.amount).toBe(600);
    expect(email.mock.calls[0][2]).toContain("₹160"); // Surmai 120 + delivery 40, still charged
  });

  it("cancelling the last live item is a whole-order cancel", async () => {
    db.orders.find((o) => o.id === "o1")!.status = "cancelled";
    await post({ order_id: "o2", status: "cancelled", cancel_reason: "Sold out" });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ order_id: "o2", event: "cancelled_by_seller" });
  });
});

describe("action=retry_refund", () => {
  const retry = (order_id: string) => post({ order_id, action: "retry_refund" });

  it("refunds a cancelled Razorpay item whose refund failed, records it and tells the buyer", async () => {
    const { status, data } = await retry("o3");
    expect(status).toBe(200);
    expect(data).toMatchObject({ ok: true, refunded: 600 });
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund.mock.calls[0][1]).toMatchObject({ id: "o3", razorpay_payment_id: "pay_1" });
    const o3 = db.orders.find((o) => o.id === "o3")!;
    expect(o3.refund_amt).toBe(600);
    expect(o3.refund_sent_at).toBeTruthy();
    expect(notify.mock.calls[0][0]).toMatchObject({ order_id: "o3", event: "refunded", amount: 600 });
  });

  it("still failing: nothing recorded as sent, nobody told it is refunded", async () => {
    refund.mockImplementation(async () => ({ ok: false, refundId: null, note: "Razorpay refund FAILED (400): not enough credits" }));
    const { status, data } = await retry("o3");
    expect(status).toBe(502);
    expect(data.ok).toBe(false);
    expect(db.orders.find((o) => o.id === "o3")!.refund_sent_at ?? null).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it("refuses another seller's order, a live item and an already-refunded one", async () => {
    db.orders.push(row("o4", { listing_id: "lx", status: "cancelled" }));
    db.orders.find((o) => o.id === "o3")!.refund_sent_at = "2026-10-30T10:00:00Z";
    expect((await retry("o4")).status).toBe(403);
    expect((await retry("o1")).data.error).toBe("Only a cancelled or declined item can be refunded");
    expect((await retry("o3")).data.error).toBe("This item is already refunded");
    expect(refund).not.toHaveBeenCalled();
  });

  it("ignores any amount the seller sends", async () => {
    await post({ order_id: "o3", action: "retry_refund", amount: 99999, final_price: 99999 });
    expect(refund.mock.calls[0]).toHaveLength(3);
    expect(db.orders.find((o) => o.id === "o3")!.refund_amt).toBe(600);
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
    expect(email.mock.calls[0][1]).toBe("Your Relifish order is confirmed");
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
