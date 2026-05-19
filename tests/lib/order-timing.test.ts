import { describe, it, expect } from "vitest";
import {
  classifyPlacementAtOrderTime,
  isPastPreorderCutoffIST,
  isPreorderShoppingWindow,
  isSellerEffectivelyOpen,
} from "../../src/lib/order-timing";

const seller = {
  opens_at: "06:00",
  closes_at: "14:00",
  accepts_preorder: true,
  open_days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  preorder_cutoff_time: "22:00",
};

describe("order-timing", () => {
  it("same_day when open on order day and within hours (IST)", () => {
    // UTC 02:30 = IST 08:00
    const now = Date.UTC(2024, 0, 15, 2, 30, 0);
    expect(isSellerEffectivelyOpen(seller, now)).toBe(true);
    expect(classifyPlacementAtOrderTime(seller, now)).toBe("same_day");
  });

  it("preorder when closed but before cutoff", () => {
    // UTC 16:00 = IST 21:30 — after close, before 22:00 cutoff
    const now = Date.UTC(2024, 0, 15, 16, 0, 0);
    expect(isSellerEffectivelyOpen(seller, now)).toBe(false);
    expect(isPreorderShoppingWindow(seller, now)).toBe(true);
    expect(classifyPlacementAtOrderTime(seller, now)).toBe("preorder");
  });

  it("closed after preorder cutoff", () => {
    const now = Date.UTC(2024, 0, 15, 18, 0, 0);
    expect(isPastPreorderCutoffIST(seller.preorder_cutoff_time, now)).toBe(true);
    expect(classifyPlacementAtOrderTime(seller, now)).toBe("closed");
  });
});
