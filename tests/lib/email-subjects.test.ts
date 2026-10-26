import { describe, expect, it } from "vitest";
import { buyerEmailCopy, deliveredOnTime, withPreview } from "../../src/lib/email-subjects";

describe("buyer email subjects (founder, 26 Oct)", () => {
  it("lead with 'Your Relifish order' and stay phone-short", () => {
    for (const k of ["placed", "confirmed", "out_for_delivery", "delivered", "seller_cancelled", "buyer_cancelled", "expired_unpaid", "refunded"] as const) {
      const { subject, preview } = buyerEmailCopy(k, { fish: "Surmai", seller: "Fishtokri", slot: "today, 12–2 PM", amount: 1380 });
      expect(subject).toMatch(/^Your Relifish (order|refund) /);
      expect(subject.length).toBeLessThanOrEqual(50);
      expect(preview.length).toBeGreaterThan(10);
    }
  });
  it("says 'on time' only when delivered before the slot ended", () => {
    expect(buyerEmailCopy("delivered", { fish: "Surmai", onTime: true }).subject).toBe("Your Relifish order is delivered, on time!");
    expect(buyerEmailCopy("delivered", { fish: "Surmai", onTime: false }).subject).toBe("Your Relifish order is delivered");
    expect(deliveredOnTime("2026-10-26T08:30:00Z", Date.parse("2026-10-26T08:00:00Z"))).toBe(true);
    expect(deliveredOnTime("2026-10-26T08:30:00Z", Date.parse("2026-10-26T09:00:00Z"))).toBe(false);
    expect(deliveredOnTime(null)).toBe(false);
  });
  it("evening pre-orders promise a 9:30 AM confirmation; previews are hidden and escaped", () => {
    expect(buyerEmailCopy("placed", { fish: "Halwa", seller: "The Nomadic Catch", eveningPreorder: true }).preview).toContain("by 9:30 AM");
    expect(buyerEmailCopy("placed", { fish: "Surmai", seller: "Fishtokri" }).preview).toContain("within 2 hours");
    const h = withPreview("<p>x</p>", "A < B");
    expect(h.startsWith('<div style="display:none')).toBe(true);
    expect(h).toContain("A &lt; B");
  });
});
