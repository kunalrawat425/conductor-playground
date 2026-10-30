import { describe, it, expect } from "vitest";
import { buyerOrderPushNotification, DEFAULT_PROMO_IMAGE } from "../../src/lib/server/buyer-order-push-copy";
import { existsSync } from "node:fs";

const ALL_STATUSES = [
  "placed", "confirmed", "picked_up",
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
      expect(n.title, s).not.toBe("Order Update");
    }
  });

  it("falls back gracefully on an unknown status, without showing the status code", () => {
    const n = buyerOrderPushNotification("teleported", "pomfret");
    expect(n.title).toBe("Order Update");
    expect(n.body).toContain("pomfret");
    expect(n.body).not.toContain("teleported");
  });

  it("never says 'seller' to the buyer (founder: order-centric wording)", () => {
    const cancels = [{ by: "seller", reason: "Sold out", refunded: true }, { by: "buyer", reason: null, refunded: false }] as any[];
    for (const s of ALL_STATUSES) {
      const all = [buyerOrderPushNotification(s, "pomfret", null, null, { when: "Sat 24 Oct, 8–10 AM", changed: true }),
        ...cancels.map((c) => buyerOrderPushNotification(s, "pomfret", null, c))];
      for (const n of all) expect(`${n.title} ${n.body}`, s).not.toMatch(/seller/i);
    }
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
 * screenshot. Razorpay is the only payment method — buyers pay in a modal.
 */
describe("buyer push copy — Razorpay only", () => {
  for (const status of ["placed", "pending_payment"]) {
    it(`${status}: asks for payment, never for a screenshot`, () => {
      const n = buyerOrderPushNotification(status, "pomfret");
      expect(n.body.toLowerCase()).not.toContain("upload");
      expect(n.body.toLowerCase()).not.toContain("screenshot");
      expect(n.body.toLowerCase()).toMatch(/pay/);
    });
  }
});

describe("admin promo push picture", () => {
  it("the default exists in public/fish", () => {
    expect(existsSync(`public${DEFAULT_PROMO_IMAGE}`)).toBe(true);
  });
});
