import { describe, it, expect } from "vitest";
import { buyerOrderPushNotification } from "../../src/lib/server/buyer-order-push-copy";

const ALL_STATUSES = [
  "placed", "proof_uploaded", "payment_verified", "confirmed", "picked_up",
  "declined", "cancelled", "paid", "completed", "refunded", "pre_order",
  "pending", "pending_payment", "payment_required", "ready_for_pickup",
  "out_for_delivery", "scheduled",
];

describe("buyer push copy — coverage", () => {
  it("every known status has non-empty title and body", () => {
    for (const s of ALL_STATUSES) {
      const n = buyerOrderPushNotification(s, "pomfret");
      expect(n.title, s).toBeTruthy();
      expect(n.body, s).toBeTruthy();
      expect(n.body, s).not.toContain("undefined");
      // A body equal to the generic fallback means the status has no entry.
      expect(n.body, s).not.toBe(`Your order status: ${s}`);
    }
  });

  it("falls back gracefully on an unknown status", () => {
    const n = buyerOrderPushNotification("teleported", "pomfret");
    expect(n.title).toBe("Order Update");
    expect(n.body).toContain("teleported");
  });

  it("works with a null species for every status", () => {
    for (const s of ALL_STATUSES) {
      const n = buyerOrderPushNotification(s, null);
      expect(n.body, s).toBeTruthy();
      expect(n.body, s).not.toContain("null");
      expect(n.body, s).not.toContain("undefined");
    }
  });

  it("interpolates species when supplied", () => {
    expect(buyerOrderPushNotification("confirmed", "surmai").body).toContain("surmai");
  });

  it("interpolates final_price into the confirmed body", () => {
    expect(buyerOrderPushNotification("confirmed", "surmai", 1990).body).toContain("₹1990");
  });
});

/**
 * BUG-23 regression: the "placed" copy told every buyer to upload a UPI
 * screenshot. With Razorpay live there is no screenshot — they pay in a modal —
 * so the copy sent them hunting for a control that does not exist.
 */
describe("buyer push copy — BUG-23 Razorpay awareness", () => {
  it("placed: does NOT mention uploading proof when Razorpay is enabled", () => {
    const n = buyerOrderPushNotification("placed", "pomfret", null, true);
    expect(n.body.toLowerCase()).not.toContain("upload");
    expect(n.body.toLowerCase()).not.toContain("screenshot");
    expect(n.body.toLowerCase()).toContain("pay");
  });

  it("placed: still asks for proof on the screenshot-only rail", () => {
    const n = buyerOrderPushNotification("placed", "pomfret", null, false);
    expect(n.body.toLowerCase()).toContain("upload");
    expect(n.body).toContain("pomfret");
  });

  it("pending_payment: reads as 'awaiting payment' when Razorpay is enabled", () => {
    const n = buyerOrderPushNotification("pending_payment", "pomfret", null, true);
    expect(n.body.toLowerCase()).not.toContain("screenshot");
    expect(n.body.toLowerCase()).toContain("payment");
  });

  it("pending_payment: reads as 'proof received' on the screenshot-only rail", () => {
    const n = buyerOrderPushNotification("pending_payment", "pomfret", null, false);
    expect(n.body.toLowerCase()).toContain("screenshot");
  });

  it("proof_uploaded: always confirms the screenshot, regardless of the flag", () => {
    // This one is emitted only after an actual upload, so the flag must not
    // change it — that was the trap in the first BUG-23 patch.
    for (const flag of [true, false]) {
      const n = buyerOrderPushNotification("proof_uploaded", "pomfret", null, flag);
      expect(n.title, String(flag)).toBe("Payment proof sent");
      expect(n.body.toLowerCase(), String(flag)).toContain("screenshot");
    }
  });

  it("no non-payment status is affected by the Razorpay flag", () => {
    const unaffected = ALL_STATUSES.filter((s) => s !== "placed" && s !== "pending_payment");
    for (const s of unaffected) {
      const on = buyerOrderPushNotification(s, "pomfret", null, true);
      const off = buyerOrderPushNotification(s, "pomfret", null, false);
      expect(on, s).toEqual(off);
    }
  });
});
