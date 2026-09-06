import { describe, it, expect } from "vitest";
import { wasActuallyPaid, refundableAmount } from "../../src/lib/order-payment-state";

/**
 * BUG-42 regression. create_order_atomic sets paid_amount = total + delivery at
 * INSERT, so it records what is OWED, not what was PAID. Readers testing
 * `paid_amount > 0` treated every unpaid order as paid and invented refund
 * obligations on cancelled orders nobody had paid for.
 */
describe("wasActuallyPaid", () => {
  it("is false for a fresh unpaid order with paid_amount pre-set", () => {
    // Exactly the shape create_order_atomic produces.
    expect(wasActuallyPaid({ paid_amount: 1800, payment_verified_at: null, razorpay_payment_id: null })).toBe(false);
  });

  it("is true once a seller verified the payment", () => {
    expect(wasActuallyPaid({ paid_amount: 1800, payment_verified_at: "2026-09-06T10:00:00Z", razorpay_payment_id: null })).toBe(true);
  });

  it("is true once Razorpay captured a payment", () => {
    expect(wasActuallyPaid({ paid_amount: 1800, payment_verified_at: null, razorpay_payment_id: "pay_abc" })).toBe(true);
  });

  it("is false when nothing is owed, regardless of marks", () => {
    expect(wasActuallyPaid({ paid_amount: 0, payment_verified_at: "2026-09-06T10:00:00Z" })).toBe(false);
    expect(wasActuallyPaid({ paid_amount: null, razorpay_payment_id: "pay_abc" })).toBe(false);
  });

  it("handles string amounts from PostgREST numerics", () => {
    expect(wasActuallyPaid({ paid_amount: "1800", razorpay_payment_id: "pay_abc" })).toBe(true);
    expect(wasActuallyPaid({ paid_amount: "1800" })).toBe(false);
  });

  it("does not throw on missing or empty input", () => {
    expect(wasActuallyPaid({})).toBe(false);
    expect(wasActuallyPaid({ paid_amount: undefined })).toBe(false);
    // Empty strings are not payment evidence.
    expect(wasActuallyPaid({ paid_amount: 100, payment_verified_at: "", razorpay_payment_id: "" })).toBe(false);
  });

  it("ignores a non-numeric amount", () => {
    expect(wasActuallyPaid({ paid_amount: "not a number", razorpay_payment_id: "pay_abc" })).toBe(false);
  });
});

describe("refundableAmount", () => {
  it("is 0 for the phantom case that caused BUG-42", () => {
    expect(refundableAmount({ paid_amount: 1800, payment_verified_at: null, razorpay_payment_id: null })).toBe(0);
  });

  it("returns the paid amount when payment is evidenced", () => {
    expect(refundableAmount({ paid_amount: 1800, razorpay_payment_id: "pay_abc" })).toBe(1800);
    expect(refundableAmount({ paid_amount: "540", payment_verified_at: "2026-09-06T10:00:00Z" })).toBe(540);
  });

  it("never returns a negative or NaN amount", () => {
    for (const amt of [null, undefined, 0, -5, "abc"] as any[]) {
      const r = refundableAmount({ paid_amount: amt, razorpay_payment_id: "pay_abc" });
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * An uploaded screenshot is only a claim, but the buyer may genuinely have sent
 * UPI money. Showing the seller a prompt they can dismiss beats silently hiding
 * a refund a buyer is owed.
 */
describe("wasActuallyPaid — UPI screenshot evidence", () => {
  it("counts an uploaded screenshot as evidence", () => {
    expect(wasActuallyPaid({
      paid_amount: 1800, payment_verified_at: null, razorpay_payment_id: null,
      payment_screenshot_urls: ["order-payments/abc/1.jpg"],
    })).toBe(true);
  });

  it("does not count an empty or non-array screenshot field", () => {
    expect(wasActuallyPaid({ paid_amount: 1800, payment_screenshot_urls: [] })).toBe(false);
    expect(wasActuallyPaid({ paid_amount: 1800, payment_screenshot_urls: null })).toBe(false);
    expect(wasActuallyPaid({ paid_amount: 1800, payment_screenshot_urls: "nope" as any })).toBe(false);
  });

  it("still requires an amount to be owed", () => {
    expect(wasActuallyPaid({ paid_amount: 0, payment_screenshot_urls: ["a.jpg"] })).toBe(false);
  });

  it("refundableAmount includes the screenshot case", () => {
    expect(refundableAmount({ paid_amount: 540, payment_screenshot_urls: ["a.jpg"] })).toBe(540);
  });
});
