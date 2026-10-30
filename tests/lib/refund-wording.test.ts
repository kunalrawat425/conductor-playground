import { describe, it, expect } from "vitest";
import { refundDueRupees, refundLine } from "../../src/lib/order-payment-state";
import { copyFor } from "../../src/lib/server/notify-order-parties";

describe("refund wording: 'refunded' only once Razorpay accepted it (30 Oct incident)", () => {
  it("succeeded vs failed/pending", () => {
    expect(refundLine(285, true)).toBe("₹285 refunded");
    expect(refundLine(1105, false)).toBe("₹1,105 refund is being processed, it reaches you in 5–7 working days");
  });
  it("seller cancel email: line and preview follow the refund outcome", () => {
    const failed = copyFor("cancelled_by_seller", "saundale", "AB12CD34", 285, "Not available", { refundSent: false });
    expect(failed.buyerLine).toContain("Refund: ₹285 refund is being processed");
    expect(failed.buyerLine).not.toMatch(/₹285 refunded/);
    expect(failed.buyerPreview).not.toMatch(/started|refunded/);
    const ok = copyFor("cancelled_by_seller", "saundale", "AB12CD34", 285, "Not available", { refundSent: true });
    expect(ok.buyerLine).toContain("Refund: ₹285 refunded.");
    expect(ok.buyerPreview).toBe("Sorry! ₹285 refunded.");
  });
});

describe("refundDueRupees: an item's share of a cart payment", () => {
  const cart = [
    { id: "a", status: "confirmed", total_price: 450, delivery_fee: 40 },
    { id: "b", status: "confirmed", total_price: 330, delivery_fee: 0 },
    { id: "c", status: "cancelled", total_price: 285, delivery_fee: 0 },
  ];
  it("item price only while other items go ahead", () => {
    expect(refundDueRupees([cart[2]], cart)).toBe(285);
    expect(refundDueRupees([cart[0]], cart)).toBe(450); // carried the fee, but the rest is still delivered
  });
  it("the last item brings the cart's delivery fee back, wherever it sits", () => {
    const rest = cart.map((r) => (r.id === "c" ? r : { ...r, status: "cancelled" }));
    expect(refundDueRupees([rest[1]], rest)).toBe(370);
    expect(refundDueRupees([rest[0], rest[1]], rest)).toBe(820);
  });
  it("a lone order is its own cart: price + fee", () => {
    expect(refundDueRupees([{ id: "x", status: "cancelled", total_price: 500, delivery_fee: 40 }])).toBe(540);
  });
});
