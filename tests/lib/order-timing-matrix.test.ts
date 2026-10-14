import { describe, it, expect } from "vitest";
import { classifyPlacementAtOrderTime, todayDayName } from "../../src/lib/order-timing";

/**
 * Checkout scenario matrix — same-day vs pre-order vs closed, as the order API
 * decides it. The seller page (src/pages/seller/[id].astro) computes the same
 * thing at render time; the two must agree or the buyer's order fails.
 */
const IST = 5.5 * 3600_000;
/** Mon 2024-01-15 at hh:mm IST, as epoch ms. */
const at = (hh: number, mm = 0, day = 15) => Date.UTC(2024, 0, day, hh, mm) - IST;

const ALL = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const base = {
  opens_at: "06:00",
  closes_at: "14:00",
  accepts_preorder: true,
  open_days: ALL,
  preorder_days: ALL,
  preorder_cutoff_time: "22:00",
};

describe("placement matrix — day shop 06:00–14:00, cutoff 22:00", () => {
  it.each([
    [5, 59, "closed"],      // before opening on an order day: not a pre-order window
    [6, 0, "same_day"],     // opens_at is inclusive
    [13, 59, "same_day"],
    [14, 0, "preorder"],    // closes_at is exclusive; pre-orders start right at close
    [21, 59, "preorder"],
    [22, 0, "closed"],      // cutoff is exclusive
    [23, 30, "closed"],
  ] as const)("%i:%i IST → %s", (h, m, want) => {
    expect(classifyPlacementAtOrderTime(base, at(h, m))).toBe(want);
  });

  it("no cutoff: pre-orders run from close until midnight", () => {
    const s = { ...base, preorder_cutoff_time: null };
    expect(classifyPlacementAtOrderTime(s, at(23, 59))).toBe("preorder");
    expect(classifyPlacementAtOrderTime(s, at(0, 30, 16))).toBe("closed"); // next day, before opening
  });
});

describe("placement matrix — overnight and midnight close", () => {
  it("closes_at 00:00 = open until midnight, never 'closed by clock' in the evening", () => {
    const s = { ...base, opens_at: "06:00", closes_at: "00:00" };
    expect(classifyPlacementAtOrderTime(s, at(23, 59))).toBe("same_day");
    expect(classifyPlacementAtOrderTime(s, at(6, 0))).toBe("same_day");
    expect(classifyPlacementAtOrderTime(s, at(5, 59))).toBe("preorder"); // past close (00:00), before cutoff
  });

  it("overnight 17:00–03:00: open across midnight, pre-order after 03:00", () => {
    const s = { ...base, opens_at: "17:00", closes_at: "03:00" };
    expect(classifyPlacementAtOrderTime(s, at(18, 0))).toBe("same_day");
    expect(classifyPlacementAtOrderTime(s, at(1, 0))).toBe("same_day");
    expect(classifyPlacementAtOrderTime(s, at(2, 59))).toBe("same_day");
    expect(classifyPlacementAtOrderTime(s, at(3, 0))).toBe("preorder");
    expect(classifyPlacementAtOrderTime(s, at(16, 59))).toBe("preorder");
  });

  it("no hours set = always open for same-day", () => {
    const s = { ...base, opens_at: null, closes_at: null };
    expect(classifyPlacementAtOrderTime(s, at(3, 0))).toBe("same_day");
  });
});

describe("placement matrix — days and switches", () => {
  it("non-order day: whole day is pre-order (before cutoff)", () => {
    const s = { ...base, open_days: ["tue"] }; // 2024-01-15 is a Monday
    expect(classifyPlacementAtOrderTime(s, at(9, 0))).toBe("preorder");
    expect(classifyPlacementAtOrderTime(s, at(22, 0))).toBe("closed");
  });

  it("non-order day and not a pre-order day: closed", () => {
    const s = { ...base, open_days: ["tue"], preorder_days: ["tue"] };
    expect(classifyPlacementAtOrderTime(s, at(9, 0))).toBe("closed");
  });

  it("accepts_preorder=false wins over saved preorder_days", () => {
    const s = { ...base, accepts_preorder: false };
    expect(classifyPlacementAtOrderTime(s, at(18, 0))).toBe("closed");
    expect(classifyPlacementAtOrderTime(s, at(9, 0))).toBe("same_day");
  });

  it("empty open_days means every day", () => {
    const s = { ...base, open_days: [] };
    expect(classifyPlacementAtOrderTime(s, at(9, 0))).toBe("same_day");
  });

  it("uses the IST day, not UTC: 00:30 IST Tuesday is Tuesday", () => {
    const now = at(0, 30, 16); // Tue 00:30 IST = Mon 19:00 UTC
    expect(todayDayName(new Date(now))).toBe("tue");
    const s = { ...base, opens_at: null, closes_at: null, open_days: ["tue"] };
    expect(classifyPlacementAtOrderTime(s, now)).toBe("same_day");
  });
});
