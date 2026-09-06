import { describe, it, expect } from "vitest";
import {
  normalizeSellerPushKind,
  sellerPushNotification,
  type SellerPushKind,
} from "../../src/lib/server/seller-push-copy";
import { sellerPushKindFor, type OrderEvent } from "../../src/lib/server/notify-order-parties";

const KINDS: SellerPushKind[] = [
  "new_order", "payment_proof", "payment_confirmed", "cancelled", "refunded",
];

describe("seller push kind normalization", () => {
  it("passes through every known kind", () => {
    for (const k of KINDS) expect(normalizeSellerPushKind(k)).toBe(k);
  });

  it("falls back to new_order for unknown, missing, or hostile values", () => {
    for (const v of [undefined, null, "", "nonsense", 42, {}, []]) {
      expect(normalizeSellerPushKind(v)).toBe("new_order");
    }
  });
});

describe("seller push copy", () => {
  it("every kind yields non-empty title and body", () => {
    for (const k of KINDS) {
      const n = sellerPushNotification(k, { species: "pomfret", order_id_short: "ab12cd34" });
      expect(n.title, k).toBeTruthy();
      expect(n.body, k).toBeTruthy();
      expect(n.body, k).not.toContain("undefined");
      expect(n.body, k).not.toContain("null");
    }
  });

  it("every kind is distinct — no two events look the same on a lock screen", () => {
    const titles = KINDS.map((k) => sellerPushNotification(k, { species: "pomfret" }).title);
    expect(new Set(titles).size).toBe(KINDS.length);
  });

  it("uppercases the short order id", () => {
    const n = sellerPushNotification("cancelled", { species: "pomfret", order_id_short: "ab12cd34" });
    expect(n.body).toContain("AB12CD34");
  });

  it("omits the order-id fragment when none is given", () => {
    const n = sellerPushNotification("cancelled", { species: "pomfret" });
    expect(n.body).not.toContain("order #");
  });

  it("survives a completely empty opts object", () => {
    for (const k of KINDS) {
      const n = sellerPushNotification(k);
      expect(n.body, k).toBeTruthy();
      expect(n.body, k).not.toContain("undefined");
    }
  });

  it("renders the amount only when supplied", () => {
    expect(sellerPushNotification("refunded", { species: "pomfret", amount: 1990 }).body).toContain("₹1990");
    expect(sellerPushNotification("refunded", { species: "pomfret" }).body).not.toContain("₹");
  });

  it("labels a preorder distinctly from a same-day order", () => {
    const pre = sellerPushNotification("new_order", { species: "pomfret", placement_kind: "preorder", quantity: 1 });
    const same = sellerPushNotification("new_order", { species: "pomfret", quantity: 1 });
    expect(pre.title).toBe("New pre-order");
    expect(same.title).toBe("New order");
  });
});

/**
 * BUG-26 regression. The fan-out coerced cancellations and refunds into the
 * "payment_proof" kind, so the seller's push read "Payment proof received.
 * Verify in dashboard." for an order the buyer had just cancelled — the exact
 * opposite of the cancellation email landing in the same second.
 */
describe("BUG-26: cancel/refund must never render as payment-proof copy", () => {
  const EVENTS: OrderEvent[] = ["payment_confirmed", "cancelled_by_buyer", "refunded"];

  it("maps each order event to a semantically matching seller kind", () => {
    expect(sellerPushKindFor("payment_confirmed")).toBe("payment_confirmed");
    expect(sellerPushKindFor("cancelled_by_buyer")).toBe("cancelled");
    expect(sellerPushKindFor("refunded")).toBe("refunded");
  });

  it("no order event maps to payment_proof or new_order", () => {
    for (const e of EVENTS) {
      const k = sellerPushKindFor(e);
      expect(k, e).not.toBe("payment_proof");
      expect(k, e).not.toBe("new_order");
    }
  });

  it("cancellation push tells the seller NOT to prepare, and mentions no verification", () => {
    const n = sellerPushNotification(sellerPushKindFor("cancelled_by_buyer"), {
      species: "pomfret", order_id_short: "AB12CD34",
    });
    expect(n.body.toLowerCase()).toContain("do not prepare");
    expect(n.body.toLowerCase()).not.toContain("verify");
    expect(n.body.toLowerCase()).not.toContain("proof");
  });

  it("payment-confirmed push tells the seller TO prepare", () => {
    const n = sellerPushNotification(sellerPushKindFor("payment_confirmed"), {
      species: "pomfret", order_id_short: "AB12CD34", amount: 1990,
    });
    expect(n.body.toLowerCase()).toContain("prepare this order");
    expect(n.body).toContain("₹1990");
  });

  it("refund push never instructs the seller to act on the order", () => {
    const n = sellerPushNotification(sellerPushKindFor("refunded"), { species: "pomfret" });
    expect(n.body.toLowerCase()).not.toContain("prepare");
    expect(n.body.toLowerCase()).not.toContain("verify");
  });

  it("seller push and seller email agree on the instruction for every event", async () => {
    const { copyFor } = await import("../../src/lib/server/notify-order-parties");
    for (const e of EVENTS) {
      const email = copyFor(e, "pomfret", "AB12CD34", 1990)!.sellerLine.toLowerCase();
      const push = sellerPushNotification(sellerPushKindFor(e), {
        species: "pomfret", order_id_short: "AB12CD34", amount: 1990,
      }).body.toLowerCase();
      // If one says "prepare" the other must not say "do not prepare".
      const emailStop = email.includes("do not prepare");
      const pushStop = push.includes("do not prepare");
      expect(emailStop, e).toBe(pushStop);
    }
  });
});
