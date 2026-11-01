import { describe, expect, it } from "vitest";
import { toSellerView } from "../../src/lib/seller-order-view";

describe("seller order view hides internal fields (founder, 1 Nov)", () => {
  it("drops refund notes and payment verifier; keeps the payment reference and refund amount", () => {
    const v: any = toSellerView({ id: "o", status: "cancelled", order_type: "delivery", buyer_phone: "919320220882",
      refund_note: "Razorpay refund FAILED (400): Your account does not have enough credits", payment_verified_by: "admin-uuid",
      razorpay_payment_id: "pay_X", refund_amt: 285, refund_sent_at: "2026-10-30T02:49:00Z" });
    expect(v.refund_note).toBeUndefined();
    expect(v.payment_verified_by).toBeUndefined();
    expect(v.buyer_phone).toBe("0882");
    expect([v.razorpay_payment_id, v.refund_amt, v.refund_sent_at]).toEqual(["pay_X", 285, "2026-10-30T02:49:00Z"]);
  });
});
