import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pickPayableCartRows, cartLabel, rowPaise, moveFeeOffClosedRow } from "../../src/lib/server/order-cart";
import { planCartSettlement, settleCapturedPayment, refundOrderRazorpay, refundCartFee } from "../../src/lib/server/razorpay-ledger";
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
    // Only the shape refundCartFee uses: "refund_amt.is.null,refund_amt.lt.<n>".
    or: (expr: string) => {
      const lt = Number(expr.match(/lt\.([\d.]+)/)?.[1]);
      filters.push((r) => r.refund_amt == null || Number(r.refund_amt) < lt);
      return b;
    },
    single: async () => { const d = run()[0]; return d ? { data: d, error: null } : { data: null, error: { message: "none" } }; },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: run(), error: null }).then(res, rej),
  };
  return b;
}
const sb = { from: (t: string) => q(t) };

/** Razorpay stub: refunds are recorded and listed back with their notes. */
let refunds: { payment: string; amount: number; notes: any }[];
let paymentAmount = 61400;
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
    const pm = String(url).match(/payments\/([^/?]+)$/);
    if (pm) {
      const refunded = refunds.filter((r) => r.payment === pm[1]).reduce((s, r) => s + (r.amount || paymentAmount), 0);
      return new Response(JSON.stringify({ id: pm[1], amount: paymentAmount, amount_refunded: refunded }), { status: 200 });
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
    // The other item is still delivered: the item's price comes back, the ₹13 fee stays.
    expect(refunds).toEqual([{ payment: "pay_1", amount: 60000, notes: { order_id: "o1" } }]);
    expect(out.refundedRupees).toBe(600);
    // A retry finds the tagged refund and does nothing.
    await refundOrderRazorpay(sb, db.orders[0] as any, { caller: "cron:refund-retry" });
    expect(refunds).toHaveLength(1);
  });

  it("removing the last item also returns the delivery fee from the item removed earlier, once", async () => {
    db.orders = [
      cartRow("o1", { status: "cancelled", delivery_fee: 13, razorpay_payment_id: "pay_1" }),
      cartRow("o2", { status: "paid", total_price: 1, razorpay_payment_id: "pay_1" }),
    ];
    await refundOrderRazorpay(sb, db.orders[0] as any, { caller: "seller/orders:cancelled" }); // o1 out, o2 still live
    db.orders[1].status = "cancelled";
    const out = await refundOrderRazorpay(sb, db.orders[1] as any, { caller: "cancel" }); // last item
    expect(out.ok).toBe(true);
    expect(refunds).toEqual([
      { payment: "pay_1", amount: 60000, notes: { order_id: "o1" } },
      { payment: "pay_1", amount: 100, notes: { order_id: "o2" } },
      { payment: "pay_1", amount: 1300, notes: { order_id: "o1" } }, // the fee
    ]);
    expect(db.orders[0].refund_amt).toBe(613);
    // Retries (cron) never hand anything back twice: total refunded = everything paid.
    await refundOrderRazorpay(sb, db.orders[0] as any, { caller: "cron:refund-retry" });
    await refundOrderRazorpay(sb, db.orders[1] as any, { caller: "cron:refund-retry" });
    expect(refunds.reduce((s, r) => s + r.amount, 0)).toBe(61400);
  });

  it("removing the item that carries the fee while others stay keeps the fee", async () => {
    db.orders = [
      cartRow("o1", { status: "paid", delivery_fee: 13, razorpay_payment_id: "pay_1" }),
      cartRow("o2", { status: "paid", total_price: 1, razorpay_payment_id: "pay_1" }),
    ];
    await refundOrderRazorpay(sb, db.orders[0] as any, { caller: "seller/orders:cancelled" });
    expect(refunds).toEqual([{ payment: "pay_1", amount: 60000, notes: { order_id: "o1" } }]);
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

describe("review findings (pre-release)", () => {
  it("B2: a balance top-up keeps the cart's upfront payment id and is settled once", async () => {
    db.orders = [
      cartRow("o1", { status: "payment_required", razorpay_order_id: "order_TOPUP", razorpay_payment_id: "pay_1", final_price: 700 }),
      cartRow("o2", { status: "paid", total_price: 1, razorpay_order_id: "order_X", razorpay_payment_id: "pay_1" }),
    ];
    const p = { razorpay_order_id: "order_TOPUP", razorpay_payment_id: "pay_top", source: "verify" };
    expect((await settleCapturedPayment(sb, p)).kind).toBe("confirmed");
    expect(db.orders[0]).toMatchObject({ status: "confirmed", razorpay_payment_id: "pay_1", balance_razorpay_payment_id: "pay_top" });
    expect((await settleCapturedPayment(sb, { ...p, source: "webhook" })).kind).toBe("already");
    expect(refunds).toHaveLength(0);
  });

  it("B2: cancelling that item refunds its upfront share (partial) and the whole top-up", async () => {
    db.orders = [
      cartRow("o1", { status: "cancelled", razorpay_payment_id: "pay_1", balance_razorpay_payment_id: "pay_top" }),
      cartRow("o2", { status: "paid", total_price: 1, razorpay_payment_id: "pay_1" }),
    ];
    db.razorpay_payments = [
      { razorpay_payment_id: "pay_1", razorpay_order_id: "order_X", order_id: "o1", refund_id: null },
      { razorpay_payment_id: "pay_top", razorpay_order_id: "order_TOPUP", order_id: "o1", refund_id: null },
    ];
    await refundOrderRazorpay(sb, db.orders[0] as any, { caller: "cancel" });
    expect(refunds).toEqual([
      { payment: "pay_1", amount: 60000, notes: { order_id: "o1" } },
      { payment: "pay_top", amount: undefined, notes: { order_id: "o1" } },
    ]);
  });

  it("H1: verify and webhook settling at once refund a closed item's share only once", async () => {
    db.orders = [cartRow("o1"), cartRow("o2", { status: "cancelled", total_price: 120 })];
    const p = { razorpay_order_id: "order_X", razorpay_payment_id: "pay_1" };
    await Promise.all([settleCapturedPayment(sb, { ...p, source: "verify" }), settleCapturedPayment(sb, { ...p, source: "webhook" })]);
    expect(refunds).toEqual([{ payment: "pay_1", amount: 12000, notes: { order_id: "o2" } }]);
  });

  it("H3: a hand refund from the dashboard (no tag) stops automatic share refunds", async () => {
    db.orders = [
      cartRow("o1", { status: "cancelled", razorpay_payment_id: "pay_1" }),
      cartRow("o2", { status: "paid", razorpay_payment_id: "pay_1" }),
    ];
    refunds.push({ payment: "pay_1", amount: 60000, notes: undefined });
    const out = await refundOrderRazorpay(sb, db.orders[0] as any, { caller: "cron:refund-retry" });
    expect(out.ok).toBe(false);
    expect(out.note).toContain("NEEDS REVIEW");
    expect(refunds).toHaveLength(1);
  });

  it("M1: removing the unpaid item that carries the fee moves the fee to the next item, once", async () => {
    db.orders = [
      cartRow("o1", { status: "cancelled", delivery_fee: 13, paid_amount: 613, razorpay_order_id: null }),
      cartRow("o2", { total_price: 1, paid_amount: 1, razorpay_order_id: null }),
    ];
    await moveFeeOffClosedRow(sb, "o1");
    await moveFeeOffClosedRow(sb, "o1");
    expect(db.orders[0]).toMatchObject({ delivery_fee: 0, paid_amount: 600 });
    expect(db.orders[1]).toMatchObject({ delivery_fee: 13, paid_amount: 14 });
    expect(pickPayableCartRows(db.orders[1] as any, db.orders as any).reduce((t, r) => t + rowPaise(r), 0)).toBe(1400);
  });

  it("M2: two last removals at the same moment send the delivery fee once", async () => {
    db.orders = [
      cartRow("o1", { status: "cancelled", delivery_fee: 13, razorpay_payment_id: "pay_1", refund_amt: 600 }),
      cartRow("o2", { status: "cancelled", total_price: 1, razorpay_payment_id: "pay_1" }),
    ];
    refunds.push({ payment: "pay_1", amount: 60000, notes: { order_id: "o1" } });
    await Promise.all([refundCartFee(sb, { ...db.orders[0] } as any, "pay_1", "a"), refundCartFee(sb, { ...db.orders[0] } as any, "pay_1", "b")]);
    expect(refunds.filter((r) => r.notes?.order_id === "o1")).toEqual([
      { payment: "pay_1", amount: 60000, notes: { order_id: "o1" } },
      { payment: "pay_1", amount: 1300, notes: { order_id: "o1" } },
    ]);
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
