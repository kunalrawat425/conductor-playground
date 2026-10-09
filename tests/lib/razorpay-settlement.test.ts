import { describe, it, expect } from "vitest";
import { decideSettlement } from "../../src/lib/server/razorpay-ledger";

/**
 * Every captured Razorpay payment is settled exactly once: confirm the order,
 * attach the id, or refund. Before, six writers each matched only pending rows,
 * so a payment that landed after cancel/decline (or a second payment from a
 * second tab) stayed captured with nothing refunding it.
 */
const pay = { razorpay_order_id: "order_A", razorpay_payment_id: "pay_1" };

describe("decideSettlement", () => {
  it("confirms a pending order awaiting this Razorpay order", () => {
    expect(decideSettlement({ id: "o", status: "pending_payment", razorpay_order_id: "order_A" }, pay)).toBe("confirm");
  });

  it("confirms a balance top-up (BUG-47)", () => {
    expect(decideSettlement({ id: "o", status: "payment_required", razorpay_order_id: "order_A", razorpay_payment_id: "pay_upfront" }, pay)).toBe("confirm");
  });

  it("is a no-op when the payment is already on the order", () => {
    expect(decideSettlement({ id: "o", status: "confirmed", razorpay_order_id: "order_A", razorpay_payment_id: "pay_1" }, pay)).toBe("already");
  });

  it("attaches the id when a seller confirmed before the payment landed", () => {
    expect(decideSettlement({ id: "o", status: "confirmed", razorpay_order_id: "order_A", razorpay_payment_id: null }, pay)).toBe("stamp");
  });

  it("refunds a payment that landed after the order was cancelled", () => {
    expect(decideSettlement({ id: "o", status: "cancelled", razorpay_order_id: "order_A" }, pay)).toBe("refund");
    expect(decideSettlement({ id: "o", status: "declined", razorpay_order_id: "order_A" }, pay)).toBe("refund");
  });

  it("refunds a second payment on an already-paid order", () => {
    expect(decideSettlement({ id: "o", status: "confirmed", razorpay_order_id: "order_A", razorpay_payment_id: "pay_0" }, pay)).toBe("refund");
  });

  it("refunds a payment for a superseded Razorpay order (amount changed)", () => {
    expect(decideSettlement({ id: "o", status: "pending_payment", razorpay_order_id: "order_B" }, pay)).toBe("refund");
  });
});
