import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buyerCancelRule, isOrderLate, LATE_CANCEL_GRACE_MIN, checkCancelReason, CANCEL_REASON_ERROR,
  cancelledByText, cancelReasonText, lateCancelReason,
} from "../../src/lib/order-cancel";

/** Late cancel (delivery over an hour past its slot end / arriving-by time) and the required cancel reason. */

const END = "2026-10-22T08:00:00.000Z";
const at = (min: number) => Date.parse(END) + min * 60_000;
const delivery = (status: string) => ({ status, order_type: "delivery", delivery_slot_start: "2026-10-22T06:00:00.000Z", delivery_slot_end: END });

describe("late cancel rule", () => {
  it("opens more than LATE_CANCEL_GRACE_MIN after the slot end", () => {
    expect(LATE_CANCEL_GRACE_MIN).toBe(60);
    expect(buyerCancelRule(delivery("out_for_delivery"), null, at(59)).ok).toBe(false);
    expect(buyerCancelRule(delivery("out_for_delivery"), null, at(60)).ok).toBe(false);
    expect(buyerCancelRule(delivery("out_for_delivery"), null, at(61))).toEqual({ ok: true, late: true });
    expect(buyerCancelRule(delivery("confirmed"), null, at(61))).toEqual({ ok: true, late: true });
  });

  it("uses the arriving-by time (delivery_slot_end) once out for delivery", () => {
    const moved = { ...delivery("out_for_delivery"), delivery_slot_end: "2026-10-22T09:30:00.000Z" };
    expect(isOrderLate(moved, Date.parse("2026-10-22T10:29:00.000Z"))).toBe(false);
    expect(isOrderLate(moved, Date.parse("2026-10-22T10:31:00.000Z"))).toBe(true);
  });

  it("never for finished orders, pickups or orders without a slot", () => {
    for (const s of ["completed", "picked_up", "delivered", "cancelled", "declined", "refunded"]) {
      expect(isOrderLate(delivery(s), at(600))).toBe(false);
    }
    expect(buyerCancelRule(delivery("completed"), null, at(600)).ok).toBe(false);
    expect(isOrderLate({ ...delivery("confirmed"), order_type: "pickup" }, at(600))).toBe(false);
    expect(isOrderLate({ status: "confirmed", order_type: "delivery" }, at(600))).toBe(false);
  });

  it("the seller reads it as late; the reason is shown without the marker", () => {
    const stored = lateCancelReason("Waited two hours");
    expect(cancelledByText("buyer", "seller", stored)).toBe("Cancelled by the buyer — order was late");
    expect(cancelledByText("buyer", "buyer", stored)).toBe("Cancelled by you — order was late");
    expect(cancelReasonText(stored)).toBe("Waited two hours");
    expect(cancelledByText("buyer", "seller", "Changed my mind")).toBe("Cancelled by the buyer");
  });
});

describe("required cancel reason", () => {
  it("needs at least 5 characters after trimming, keeps at most 200", () => {
    for (const bad of [undefined, null, "", "    ", "abcd", "  abcd  "]) expect(checkCancelReason(bad)).toEqual({ ok: false, error: CANCEL_REASON_ERROR });
    expect(checkCancelReason("  Fish sold out  ")).toEqual({ ok: true, reason: "Fish sold out" });
    const long = checkCancelReason("x".repeat(250));
    expect(long.ok && long.reason.length).toBe(200);
    // A typed "late|" can't fake a late cancel.
    expect(checkCancelReason("late|nope")).toEqual({ ok: false, error: CANCEL_REASON_ERROR });
  });
});

// ── Server enforcement: /api/orders/cancel and /api/seller/orders against an in-memory DB ──
type Row = Record<string, any>;
const db: Record<string, Row[]> = { orders: [], fish_listings: [] };
function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let payload: Row | null = null;
  const run = () => {
    const hit = db[table].filter((r) => filters.every((f) => f(r)));
    if (payload) hit.forEach((r) => Object.assign(r, payload));
    return hit;
  };
  const q: any = {
    select: () => q, not: () => q, neq: () => q, order: () => q,
    update: (p: Row) => { payload = p; return q; },
    eq: (k: string, v: any) => { filters.push((r) => r[k] === v); return q; },
    single: async () => { const d = run()[0]; return d ? { data: d, error: null } : { data: null, error: { message: "not found" } }; },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve().then(() => ({ data: run(), error: null })).then(res, rej),
  };
  return q;
}
const refund = vi.fn(async () => ({ ok: true, refundId: "rfnd_1", note: "Refunded", refundedRupees: 540 }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: query }) }));
vi.mock("../../src/lib/server/session", () => ({ requireBuyer: () => null }));
vi.mock("../../src/lib/server/assert-seller", () => ({ assertSellerOwns: async () => ({ ok: true }) }));
vi.mock("../../src/lib/server/razorpay-ledger", () => ({ refundOrderRazorpay: () => refund() }));
vi.mock("../../src/lib/server/notify-order-parties", () => ({ notifyOrderParties: async () => ({}) }));
vi.mock("../../src/lib/server/buyer-push", () => ({ sendBuyerOrderPush: async () => ({ ok: true }) }));

const { POST: cancelPOST } = await import("../../src/pages/api/orders/cancel");
const { POST: sellerPOST } = await import("../../src/pages/api/seller/orders");
const call = async (post: any, body: Row) => {
  const res = await post({ request: new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), url: new URL("http://x") } as any);
  return { status: res.status, body: await res.json() };
};

describe("server: reason required, late out-for-delivery cancel refunds", () => {
  beforeEach(() => {
    refund.mockClear();
    db.fish_listings = [{ id: "l1", seller_id: "s1", seller: null }];
    db.orders = [{
      id: "o1", buyer_id: "b1", listing_id: "l1", cart_id: null, status: "out_for_delivery", order_type: "delivery",
      delivery_slot_start: new Date(Date.now() - 4 * 3600_000).toISOString(), delivery_slot_end: new Date(Date.now() - 2 * 3600_000).toISOString(),
      payment_method: "razorpay", razorpay_payment_id: "pay_1", paid_amount: 540, total_price: 500, delivery_fee: 40,
    }];
  });

  it("buyer cancel without a reason is refused in plain words", async () => {
    expect(await call(cancelPOST, { order_id: "o1", buyer_id: "b1", action: "cancel", cancel_reason: " no " }))
      .toEqual({ status: 400, body: { error: CANCEL_REASON_ERROR } });
    expect(db.orders[0].status).toBe("out_for_delivery");
  });

  it("late out-for-delivery order: cancelled, marked late, refunded through the usual path", async () => {
    const r = await call(cancelPOST, { order_id: "o1", buyer_id: "b1", action: "cancel", cancel_reason: "Waited two hours", whole_cart: true });
    expect(r.status).toBe(200);
    expect(db.orders[0]).toMatchObject({ status: "cancelled", cancelled_by: "buyer", cancel_reason: "late|Waited two hours", refund_amt: 540 });
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it("not late yet: out for delivery can't be cancelled", async () => {
    db.orders[0].delivery_slot_end = new Date(Date.now() - 30 * 60_000).toISOString();
    expect((await call(cancelPOST, { order_id: "o1", buyer_id: "b1", action: "cancel", cancel_reason: "Waited too long" })).status).toBe(400);
    expect(refund).not.toHaveBeenCalled();
  });

  it("seller cancel / decline without a reason is refused", async () => {
    for (const status of ["cancelled", "declined"]) {
      expect(await call(sellerPOST, { seller_id: "s1", seller_phone: "9", order_id: "o1", status }))
        .toEqual({ status: 400, body: { error: CANCEL_REASON_ERROR } });
    }
    expect(db.orders[0].status).toBe("out_for_delivery");
  });
});

describe("reason dialog (client)", () => {
  it("blocks an empty reason, then resolves the trimmed text", async () => {
    const { askCancelReason } = await import("../../src/lib/reason-dialog");
    const p = askCancelReason({ title: "Cancel this order?", label: "Why are you cancelling?", confirmText: "Cancel order" });
    const dlg = document.querySelector("dialog")!;
    const form = dlg.querySelector("form")!;
    form.requestSubmit();
    expect(dlg.querySelector("[data-err]")!.textContent).toBe(CANCEL_REASON_ERROR);
    expect(dlg.open).toBe(true);
    dlg.querySelector("textarea")!.value = "  Plans changed  ";
    form.requestSubmit();
    expect(await p).toBe("Plans changed");
    expect(document.querySelector("dialog")).toBeNull();
  });
});
