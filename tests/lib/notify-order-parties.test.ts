import { describe, it, expect } from "vitest";
import { copyFor, pushStatusFor, type OrderEvent } from "../../src/lib/server/notify-order-parties";
import { buyerOrderPushNotification } from "../../src/lib/server/buyer-order-push-copy";

const EVENTS: OrderEvent[] = ["payment_confirmed", "cancelled_by_buyer", "refunded"];

/**
 * BUG-20 / BUG-21 regression suite.
 *
 * The original defect was structural: order events reached at most one party on
 * at most one channel. The fan-out helper is only correct if EVERY event yields
 * distinct, non-empty copy for BOTH audiences, and if the buyer-push status it
 * emits is one the push-copy module actually knows about.
 */
describe("notify-order-parties copy", () => {
  it("produces all six copy fields for every event", () => {
    for (const e of EVENTS) {
      const c = copyFor(e, "pomfret", "AB12CD34", 1990)!;
      for (const k of ["buyerSubject", "buyerHeading", "buyerLine", "sellerSubject", "sellerHeading", "sellerLine"] as const) {
        expect(c[k], `${e}.${k}`).toBeTruthy();
        expect(typeof c[k]).toBe("string");
      }
    }
  });

  it("never sends the buyer the seller's line (BUG-21: audiences must differ)", () => {
    for (const e of EVENTS) {
      const c = copyFor(e, "pomfret", "AB12CD34", 1990)!;
      expect(c.buyerLine, e).not.toBe(c.sellerLine);
    }
  });

  it("embeds species and short order id in both audiences' lines", () => {
    for (const e of EVENTS) {
      const c = copyFor(e, "surmai", "DEADBEEF", 500)!;
      expect(c.buyerLine).toContain("surmai");
      expect(c.buyerLine).toContain("DEADBEEF");
      expect(c.sellerLine).toContain("surmai");
      expect(c.sellerLine).toContain("DEADBEEF");
    }
  });

  it("falls back to 'fish' when species is empty", () => {
    const c = copyFor("payment_confirmed", "", "AB12CD34", null)!;
    expect(c.buyerLine).toContain("fish");
    expect(c.sellerLine).toContain("fish");
  });

  it("omits the amount fragment entirely when amount is null", () => {
    for (const e of EVENTS) {
      const c = copyFor(e, "pomfret", "AB12CD34", null)!;
      expect(c.buyerLine, e).not.toContain("₹");
      expect(c.sellerLine, e).not.toContain("₹");
    }
  });

  it("renders the rupee amount when supplied", () => {
    const c = copyFor("refunded", "pomfret", "AB12CD34", 1990)!;
    expect(c.buyerLine).toContain("₹1990");
    expect(c.sellerLine).toContain("₹1990");
  });

  it("tells the seller NOT to prepare a buyer-cancelled order", () => {
    const c = copyFor("cancelled_by_buyer", "pomfret", "AB12CD34", 1990)!;
    // This is the whole point of BUG-20 — the seller was previously told nothing
    // and could prep an order cancelled hours earlier.
    expect(c.sellerLine.toLowerCase()).toContain("do not prepare");
    expect(c.sellerSubject).toContain("CANCELLED");
  });

  it("tells the seller TO prepare a payment-confirmed order", () => {
    const c = copyFor("payment_confirmed", "pomfret", "AB12CD34", 1990)!;
    expect(c.sellerLine.toLowerCase()).toContain("prepare this order");
  });

  it("mentions refund timing to the buyer only", () => {
    const c = copyFor("refunded", "pomfret", "AB12CD34", 1990)!;
    expect(c.buyerLine).toContain("5–7 working days");
    expect(c.sellerLine).not.toContain("5–7 working days");
  });
});

describe("notify-order-parties push status mapping", () => {
  it("maps each event to a status the buyer push-copy module recognises", () => {
    const expected: Record<OrderEvent, string> = {
      payment_confirmed: "confirmed",
      cancelled_by_buyer: "cancelled",
      refunded: "refunded",
    };
    for (const e of EVENTS) {
      const status = pushStatusFor(e);
      expect(status).toBe(expected[e]);
      // The mapping is worthless if the copy module has no entry — it would
      // silently fall through to generic copy.
      const n = buyerOrderPushNotification(status, "pomfret");
      expect(n.title).toBeTruthy();
      expect(n.body).toBeTruthy();
      expect(n.body).not.toBe("");
    }
  });

  it("produces distinct push copy per event (no collisions)", () => {
    const bodies = EVENTS.map((e) => buyerOrderPushNotification(pushStatusFor(e), "pomfret").body);
    expect(new Set(bodies).size).toBe(EVENTS.length);
  });
});
