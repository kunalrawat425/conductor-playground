import { describe, it, expect } from "vitest";
import {
  istDayStartISO,
  classifyPlacementAtOrderTime,
  isPastPreorderCutoffIST,
  isPreorderShoppingWindow,
  isSellerEffectivelyOpen,
  isAfterCloseTimeIST,
  todayDayName,
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

  it("preorder when after close time and before cutoff", () => {
    // UTC 16:00 = IST 21:30 — after closes_at 14:00, before 22:00 cutoff
    const now = Date.UTC(2024, 0, 15, 16, 0, 0);
    expect(isSellerEffectivelyOpen(seller, now)).toBe(false);
    expect(isAfterCloseTimeIST(seller, now)).toBe(true);
    expect(isPreorderShoppingWindow(seller, now)).toBe(true);
    expect(classifyPlacementAtOrderTime(seller, now)).toBe("preorder");
  });

  it("NOT preorder before store opens (same order day, before opens_at)", () => {
    // UTC 00:00 = IST 05:30 — before opens_at 06:00 on an order day
    const now = Date.UTC(2024, 0, 15, 0, 0, 0);
    expect(isSellerEffectivelyOpen(seller, now)).toBe(false);
    expect(isAfterCloseTimeIST(seller, now)).toBe(false); // not past close time
    // preorder window should NOT be active before store opens on an order day
    expect(isPreorderShoppingWindow(seller, now)).toBe(false);
    expect(classifyPlacementAtOrderTime(seller, now)).toBe("closed");
  });

  it("NOT preorder between opens_at and closes_at", () => {
    // UTC 04:00 = IST 09:30 — during open hours
    const now = Date.UTC(2024, 0, 15, 4, 0, 0);
    expect(isSellerEffectivelyOpen(seller, now)).toBe(true);
    expect(isPreorderShoppingWindow(seller, now)).toBe(false);
  });

  it("closed after preorder cutoff", () => {
    const now = Date.UTC(2024, 0, 15, 18, 0, 0);
    expect(isPastPreorderCutoffIST(seller.preorder_cutoff_time, now)).toBe(true);
    expect(classifyPlacementAtOrderTime(seller, now)).toBe("closed");
  });
});

describe("todayDayName — IST midnight boundary (regression for UTC getDay bug)", () => {
  it("returns IST day not UTC day at 18:30 UTC (= 00:00 IST next day)", () => {
    // Mon 2024-01-15 18:30 UTC = Tue 2024-01-16 00:00 IST
    // Before fix: d.getDay() returned 1 (Mon/UTC). After fix: returns 2 (Tue/IST).
    const utcMidnightIST = Date.UTC(2024, 0, 15, 18, 30, 0);
    expect(todayDayName(new Date(utcMidnightIST))).toBe("tue");
  });

  it("returns correct IST day at 23:59 UTC (= 05:29 IST next day)", () => {
    // Mon 2024-01-15 23:59 UTC = Tue 2024-01-16 05:29 IST
    const nowMs = Date.UTC(2024, 0, 15, 23, 59, 0);
    expect(todayDayName(new Date(nowMs))).toBe("tue");
  });

  it("returns same day when UTC and IST agree (midday UTC)", () => {
    // Mon 2024-01-15 06:00 UTC = Mon 2024-01-15 11:30 IST
    const nowMs = Date.UTC(2024, 0, 15, 6, 0, 0);
    expect(todayDayName(new Date(nowMs))).toBe("mon");
  });

  it("wrong day causes seller to be misclassified as closed on open day", () => {
    // The actual production bug: seller open Mon-Sun, but at 19:00 UTC on Monday,
    // old code returned "mon" (UTC), new code returns "tue" (IST).
    // Both are in open_days so no visible difference in this case —
    // the real issue was sellers with partial open_days hitting the wrong day.
    const sellerMonOnly = { ...seller, open_days: ["tue"] };
    // At 19:00 UTC Mon = 00:30 IST Tue — should be "open on tue"
    const nowMs = Date.UTC(2024, 0, 15, 19, 0, 0); // Mon UTC = Tue IST
    expect(todayDayName(new Date(nowMs))).toBe("tue");
    expect(isSellerEffectivelyOpen(sellerMonOnly, nowMs)).toBe(
      // IST time is 00:30 — before opens_at 06:00 so closed by clock, but correct day
      false // closed by clock (00:30 IST < 06:00 opens_at), but day is correct (tue ✓)
    );
  });
});

/**
 * BUG-45: the per-buyer daily quantity cap used `setHours(0,0,0,0)`, which
 * zeroes the time in the SERVER's zone. On Vercel (UTC) the window ran
 * 05:30 IST -> 05:30 IST, so a 5 kg/day cap allowed 5 kg at 02:00 IST plus
 * another 5 kg at 06:00 IST — 10 kg inside one IST day.
 */
describe("istDayStartISO", () => {
  const IST = 5.5 * 60 * 60 * 1000;

  it("returns 00:00 IST, i.e. 18:30 UTC the previous day", () => {
    // 2026-09-06 14:00 IST
    const noonIst = Date.UTC(2026, 8, 6, 14, 0) - IST;
    expect(istDayStartISO(noonIst)).toBe("2026-09-05T18:30:00.000Z");
  });

  it("does not roll the day over at 00:00 UTC", () => {
    // 00:30 UTC on 2026-09-07 is 06:00 IST the same IST day.
    const justAfterUtcMidnight = Date.UTC(2026, 8, 7, 0, 30);
    // 23:00 UTC on 2026-09-06 is 04:30 IST on the 7th — same IST day as above.
    const beforeUtcMidnight = Date.UTC(2026, 8, 6, 23, 0);
    expect(istDayStartISO(justAfterUtcMidnight)).toBe(istDayStartISO(beforeUtcMidnight));
  });

  it("DOES roll over at 00:00 IST", () => {
    // 18:29 UTC = 23:59 IST (day N). 18:31 UTC = 00:01 IST (day N+1).
    const lastMinuteOfIstDay = Date.UTC(2026, 8, 6, 18, 29);
    const firstMinuteOfNextIstDay = Date.UTC(2026, 8, 6, 18, 31);
    expect(istDayStartISO(lastMinuteOfIstDay)).not.toBe(istDayStartISO(firstMinuteOfNextIstDay));
  });

  it("is stable across the whole of one IST day", () => {
    const start = Date.UTC(2026, 8, 6, 18, 30); // 00:00 IST on the 7th
    const stamps = [0, 1, 6, 12, 18, 23.9].map((h) => istDayStartISO(start + h * 3600e3));
    expect(new Set(stamps).size).toBe(1);
  });

  it("the 02:00 and 06:00 IST case that defeated the cap now shares a window", () => {
    const twoAmIst = Date.UTC(2026, 8, 7, 2, 0) - IST;
    const sixAmIst = Date.UTC(2026, 8, 7, 6, 0) - IST;
    expect(istDayStartISO(twoAmIst)).toBe(istDayStartISO(sixAmIst));
  });
});
