import { describe, expect, it } from "vitest";
import { closedStatusLabel } from "../../src/lib/cart";

// The Nomadic Catch on 25 Oct 2026: pre-order only, delivers Wed & Sun, pre-orders pause 2 AM–1 PM.
const nomadic = {
  opens_at: "08:00:00", closes_at: "22:00:00", open_days: [] as string[], accepts_preorder: true,
  preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], preorder_cutoff_time: "02:00:00",
  preorder_opens_at: "13:00:00", delivery_days: ["wed", "sun"],
};
const ist = (iso: string) => Date.parse(`${iso}+05:30`);

describe("closedStatusLabel", () => {
  it("never says 'Opens 8 AM' for a pre-order-only seller; names when pre-orders reopen", () => {
    const label = closedStatusLabel(nomadic, ist("2026-10-25T08:19:00")); // Sunday morning, paused
    expect(label).not.toContain("Opens 8");
    expect(label).toMatch(/^Pre-orders open /);
  });
  it("keeps 'Opens <time>' for a same-day seller", () => {
    expect(closedStatusLabel({ ...nomadic, open_days: ["mon"] }, ist("2026-10-25T06:00:00"))).toBe("Opens 8 AM");
  });
  it("says Closed when a pre-order-only seller doesn't take pre-orders", () => {
    expect(closedStatusLabel({ ...nomadic, accepts_preorder: false }, ist("2026-10-25T08:19:00"))).toBe("Closed");
  });
});
