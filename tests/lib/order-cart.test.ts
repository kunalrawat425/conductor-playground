import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pickPayableCartRows, cartLabel, rowPaise } from "../../src/lib/server/order-cart";
import { planCartSettlement, settleCapturedPayment, refundOrderRazorpay } from "../../src/lib/server/razorpay-ledger";
import { orderEmailBuyer, orderEmailSeller } from "../../src/lib/email-templates";
import { sellerPushNotification } from "../../src/lib/server/seller-push-copy";

/**
 * One checkout = one cart = one payment. A 2-item cart used to create two orders
 * that were paid separately: the buyer paid the first and the rest expired unpaid.
 * Now every row shares cart_id, one Razorpay order charges them all, and a
 * refund for one item is a partial refund of that item's share only.
 */

vi.mock("../../src/lib/server/after-response", () => ({ afterResponse: () => {} }));
vi.mock("../../src/lib/server/ga-mp", () => ({ gaPurchase: async () => {}, gaRefund: async () => {} }));

type Row = Record<string, any>;
let db: Record<string, Row[]>;

function q(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "update" | "upsert" = "select";
  let payload: Row = {};
  const hit = () => db[table].filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (op === "update") { const h = hit(); h.forEach((r) => Object.assign(r, payload)); return h.map((r) => ({ ...r })); }
    if (op === "upsert") {
      if (!db[table].some((r) => r.razorpay_payment_id === payload.razorpay_payment_id)) db[table].push({ ...payload, refund_id: null });
      return [];
    }
    return hit().map((r) => ({ ...r }));
  };
  const b: any = {
    select: () => b, order: () => b, limit: () => b,
    update: (p: Row) => { op = "update"; payload = p; return b; },
    upsert: (p: Row) => { op = "upsert"; payload = p; return b; },
    eq: (k: string, v: any) => { filters.push((r) => r[k] === v); return b; },
    neq: (k: string, v: any) => { filters.push((r) => r[k] !== v); return b; },
    in: (k: string, vs: any[]) => { filters.push((r) => vs.includes(r[k])); return b; },
    is: (k: string, v: any) => { filters.push((r) => (r[k] ?? null) === v); return b; },
    single: async () => { const d = run()[0]; return d ? { data: d, error: null } : { data: null, error: { message: "none" } }; },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: run(), error: null }).then(res, rej),
  };
  return b;
}
const sb = { from: (t: string) => q(t) };

/** Razorpay stub: refunds are recorded and listed back with their notes. */
let refunds: { payment: string; amount: number; notes: any }[];
function stubRazorpay() {
  refunds = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
    const m = String(url).match(/payments\/([^/]+)\/refunds?/);
    if (m && init?.method === "POST") {
      const body = JSON.parse(init.body);
      refunds.push({ payment: m[1], amount: body.amount, notes: body.notes });
      return new Response(JSON.stringify({ id: `rfnd_${refunds.length}` }), { status: 200 });
    }
    if (m) {
      const items = refunds.filter((r) => r.payment === m[1]).map((r) => ({ amount: r.amount, notes: r.notes, status: "processed" }));
      return new Response(JSON.stringify({ items }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }));
}

const cartRow = (id: string, over: Row = {}): Row => ({
  id, cart_id: "cart_1", buyer_id: "b1", status: "pending_payment", total_price: 600, delivery_fee: 0,
  razorpay_order_id: "order_X", razorpay_payment_id: null, created_at: `2026-10-15T00:0${id.slice(-1)}:00Z`, ...over,
});

beforeEach(() => {
  vi.stubEnv("PUBLIC_RAZORPAY_KEY_ID", "rzp_test");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "secret");
  db = { orders: [], razorpay_payments: [] };
  stubRazorpay();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("pickPayableCartRows", () => {
  const a = cartRow("o1", { delivery_fee: 13, razorpay_order_id: null });
  it("charges every unpaid item of the cart from any item's Pay button", () => {
    const b = cartRow("o2", { total_price: 1, razorpay_order_id: null });
    const rows = pickPayableCartRows(b, [a, b]);
    expect(rows.map((r) => r.id)).toEqual(["o1", "o2"]);
    expect(rows.reduce((s, r) => s + rowPaise(r), 0)).toBe(61400); // 600 + 13 + 1
  });
  it("skips cancelled items, paid items, other buyers and other Razorpay orders", () => {
    const rows = pickPayableCartRows(a, [
      a,
      cartRow("o2", { status: "cancelled", razorpay_order_id: null }),
      cartRow("o3", { razorpay_payment_id: "pay_0" }),
      cartRow("o4", { buyer_id: "b2", razorpay_order_id: null }),
      cartRow("o5", { razorpay_order_id: "order_OTHER" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["o1"]);
  });
  it("leaves an order without cart_id on its own (old orders unchanged)", () => {
    expect(pickPayableCartRows({ ...a, cart_id: null }, [a]).map((r) => r.id)).toEqual(["o1"]);
  });
});

describe("planCartSettlement", () => {
  const p = { razorpay_order_id: "order_X", razorpay_payment_id: "pay_1" };
  it("confirms the waiting items and refunds an item cancelled before the payment landed", () => {
    const plan = planCartSettlement([cartRow("o1"), cartRow("o2", { status: "cancelled" })], p);
    expect(plan.confirm.map((r) => r.id)).toEqual(["o1"]);
    expect(plan.refund.map((r) => r.id)).toEqual(["o2"]);
  });
  it("never lets a cart payment settle a balance top-up", () => {
    const plan = planCartSettlement([cartRow("o1"), cartRow("o2", { status: "payment_required" })], p);
    expect(plan.refund.map((r) => r.id)).toEqual(["o2"]);
  });
});

describe("settleCapturedPayment on a cart", () => {
  const p = { razorpay_order_id: "order_X", razorpay_payment_id: "pay_1", source: "verify" };

  it("marks every item paid in one go and reports all of them", async () => {
    db.orders = [cartRow("o1", { delivery_fee: 13 }), cartRow("o2", { total_price: 1 })];
    const r = await settleCapturedPayment(sb, p);
    expect(r.kind).toBe("confirmed");
    expect((r as any).orders.map((o: any) => o.id)).toEqual(["o1", "o2"]);
    expect(db.orders.every((o) => o.status === "paid" && o.razorpay_payment_id === "pay_1")).toBe(true);
    expect(refunds).toHaveLength(0);
  });

  it("is a no-op the second time (webhook after verify)", async () => {
    db.orders = [cartRow("o1"), cartRow("o2")];
    await settleCapturedPayment(sb, p);
    const again = await settleCapturedPayment(sb, { ...p, source: "webhook" });
    expect(again.kind).toBe("already");
    expect(refunds).toHaveLength(0);
  });

  it("refunds only the cancelled item's share, once", async () => {
    db.orders = [cartRow("o1", { delivery_fee: 13 }), cartRow("o2", { status: "cancelled", total_price: 120 })];
    const r = await settleCapturedPayment(sb, p);
    expect(r.kind).toBe("confirmed");
    expect(refunds).toEqual([{ payment: "pay_1", amount: 12000, notes: { order_id: "o2" } }]);
    // The cron re-scans closed rows daily: it must not refund the share again.
    await settleCapturedPayment(sb, { ...p, source: "cron" });
    expect(refunds).toHaveLength(1);
  });

  it("refunds the whole payment when no item can keep it", async () => {
    db.orders = [cartRow("o1", { status: "cancelled" }), cartRow("o2", { status: "cancelled" })];
    const r = await settleCapturedPayment(sb, p);
    expect(r.kind).toBe("refunded");
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBeUndefined(); // full refund
  });
});

describe("refundOrderRazorpay on a cart paid in one go", () => {
  it("cancelling one item refunds that item's share, not the whole payment", async () => {
    db.orders = [
      cartRow("o1", { status: "cancelled", delivery_fee: 13, razorpay_payment_id: "pay_1" }),
      cartRow("o2", { status: "paid", total_price: 1, razorpay_payment_id: "pay_1" }),
    ];
    db.razorpay_payments = [{ razorpay_payment_id: "pay_1", razorpay_order_id: "order_X", order_id: "o1", refund_id: null }];
    const out = await refundOrderRazorpay(sb, db.orders[0] as any, { caller: "cancel" });
    expect(out.ok).toBe(true);
    expect(refunds).toEqual([{ payment: "pay_1", amount: 61300, notes: { order_id: "o1" } }]);
    // A retry finds the tagged refund and does nothing.
    await refundOrderRazorpay(sb, db.orders[0] as any, { caller: "cron:refund-retry" });
    expect(refunds).toHaveLength(1);
  });

  it("a pre-order difference already refunded is subtracted from the item's share", async () => {
    db.orders = [
      cartRow("o1", { status: "cancelled", total_price: 600, razorpay_payment_id: "pay_1" }),
      cartRow("o2", { status: "paid", razorpay_payment_id: "pay_1" }),
    ];
    refunds.push({ payment: "pay_1", amount: 10000, notes: { order_id: "o1" } }); // seller priced it ₹100 lower
    await refundOrderRazorpay(sb, db.orders[0] as any, { caller: "cancel" });
    expect(refunds[1]).toEqual({ payment: "pay_1", amount: 50000, notes: { order_id: "o1" } });
  });
});

describe("one notification for a cart", () => {
  it("labels a cart in pushes and subjects", () => {
    expect(cartLabel(["pomfret", "surmai"])).toBe("Pomfret + Surmai");
    expect(cartLabel(["pomfret", "surmai", "halwa"])).toBe("Pomfret + 2 more");
  });

  it("seller push for a new cart says how many items and the total", () => {
    const { body } = sellerPushNotification("new_order", { species: "Pomfret + Surmai", item_count: 2, amount: 613 });
    expect(body).toBe("New order: Pomfret + Surmai (2 items) · ₹613");
  });

  it("order emails list every item with the cart total and delivery fee", () => {
    const args = {
      statusLabel: "Order placed — complete payment to confirm", species: "Pomfret + Surmai", quantity: 5, quantity_unit: "piece",
      totalAmount: 613, deliveryFee: 12,
      items: [
        { species: "pomfret", quantity: 5, quantity_unit: "piece", total_price: 600, pricingLabel: "Option (5pc)" },
        { species: "surmai", quantity: 0.15, quantity_unit: "kg", total_price: 1 },
      ],
    };
    for (const html of [orderEmailBuyer(args), orderEmailSeller(args)]) {
      expect(html).toContain("Pomfret");
      expect(html).toContain("Surmai");
      expect(html).toContain("₹601"); // subtotal
      expect(html).toContain("₹613");
    }
  });

  it("a single-item email with a delivery fee renders (it used to throw: subtotal was undefined)", () => {
    const html = orderEmailBuyer({ statusLabel: "Paid", species: "pomfret", quantity: 1, quantity_unit: "kg", totalAmount: 553, deliveryFee: 13 });
    expect(html).toContain("₹540");
    expect(html).toContain("₹553");
  });
});
