import { describe, it, expect } from "vitest";
import {
  closedSellerMessage,
  isOvernightCutoff,
  pausesOnlyOnDeliveryDays,
  preorderPauseLabel,
  preorderDeliveryDateIST,
  preorderDeliveryLabel,
  preorderHoursLabel,
  preorderPlacedLabel,
  preorderStatusLabel,
  preorderWindowDaysBack,
  istDayStartISO,
  classifyPlacementAtOrderTime,
  isPastPreorderCutoffIST,
  isPreorderShoppingWindow,
  isSellerEffectivelyOpen,
  isAfterCloseTimeIST,
  isTodayOrderDay,
  todayDayName,
} from "../../src/lib/order-timing";
import { nextModeBoundaryMs, nextPlacementStartMs } from "../../src/lib/cart";

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

describe("open_days: null vs [] (pre-order-only sellers)", () => {
  it("null/undefined open_days = order day (legacy)", () => {
    expect(isTodayOrderDay({ open_days: null }, "wed")).toBe(true);
    expect(isTodayOrderDay({}, "wed")).toBe(true);
  });
  it("[] = never an order day", () => {
    expect(isTodayOrderDay({ open_days: [] }, "wed")).toBe(false);
  });
  it("subset of days", () => {
    expect(isTodayOrderDay({ open_days: ["tue"] }, "tue")).toBe(true);
    expect(isTodayOrderDay({ open_days: ["tue"] }, "wed")).toBe(false);
  });

  // The Nomadic Catch: no same-day days, pre-orders Tue + Sat until 22:00.
  const preorderOnly = {
    open_days: [],
    opens_at: "08:00",
    closes_at: "22:00",
    accepts_preorder: true,
    preorder_days: ["tue", "sat"],
    preorder_cutoff_time: "22:00",
  };
  const tue = (h: number, m: number) => Date.UTC(2026, 9, 20, h, m) - 5.5 * 3_600_000; // IST on Tue 20 Oct 2026
  it("pre-order window all day on a pre-order day until cutoff", () => {
    expect(isPreorderShoppingWindow(preorderOnly, tue(11, 0))).toBe(true);
    expect(classifyPlacementAtOrderTime(preorderOnly, tue(11, 0))).toBe("preorder");
    expect(isPreorderShoppingWindow(preorderOnly, tue(22, 30))).toBe(false);
  });
  it("closed on a non-pre-order day, never same-day", () => {
    const wed = tue(11, 0) + 86_400_000;
    expect(todayDayName(new Date(wed))).toBe("wed");
    expect(isPreorderShoppingWindow(preorderOnly, wed)).toBe(false);
    expect(classifyPlacementAtOrderTime(preorderOnly, wed)).toBe("closed");
  });
});

/**
 * Overnight pre-order cutoff (founder, 22 Oct): the window opened on pre-order day D runs
 * past midnight to the cutoff on D+1, and 00:00–cutoff counts as D's window.
 * Week of Mon 15 Jan 2024 (IST).
 */
describe("overnight pre-order cutoff", () => {
  const DAYS: Record<string, number> = { mon: 15, tue: 16, wed: 17, thu: 18, fri: 19, sat: 20, sun: 21 };
  /** IST wall-clock time on a weekday of that week, as epoch ms. */
  const at = (day: string, hh: number, mm = 0) => Date.UTC(2024, 0, DAYS[day], hh, mm) - 5.5 * 3_600_000;
  const date = (day: string) => `2024-01-${DAYS[day]}`;

  const fishtokri = {
    opens_at: "08:00",
    closes_at: "18:00",
    open_days: ["tue", "wed", "thu", "fri", "sat", "sun"],
    preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat"],
    accepts_preorder: true,
    preorder_cutoff_time: "03:00",
  };

  describe("Fishtokri (same-day 8 AM–6 PM Tue–Sun, pre-orders Mon–Sat till 3 AM)", () => {
    it("is an overnight cutoff", () => {
      expect(isOvernightCutoff(fishtokri)).toBe(true);
      expect(isOvernightCutoff({ ...fishtokri, preorder_cutoff_time: "22:00" })).toBe(false);
    });
    it("Tue 19:00 → preorder for Wed", () => {
      expect(classifyPlacementAtOrderTime(fishtokri, at("tue", 19))).toBe("preorder");
      expect(preorderDeliveryDateIST(fishtokri, at("tue", 19))).toBe(date("wed"));
    });
    it("Tue 23:30 → preorder", () => {
      expect(classifyPlacementAtOrderTime(fishtokri, at("tue", 23, 30))).toBe("preorder");
    });
    it("Wed 01:30 → preorder in Tuesday's window, scheduled for Wed morning (not Thu)", () => {
      const t = at("wed", 1, 30);
      expect(classifyPlacementAtOrderTime(fishtokri, t)).toBe("preorder");
      expect(preorderWindowDaysBack(fishtokri, t)).toBe(1);
      expect(preorderDeliveryDateIST(fishtokri, t)).toBe(date("wed"));
      expect(preorderDeliveryLabel(fishtokri, t)).toBe("today");
      expect(preorderPlacedLabel(preorderDeliveryDateIST(fishtokri, t), t)).toBe("Pre-order placed — catch reserved for today");
    });
    it("Wed 03:30 → closed until same-day opens at 8 AM", () => {
      const t = at("wed", 3, 30);
      expect(classifyPlacementAtOrderTime(fishtokri, t)).toBe("closed");
      expect(closedSellerMessage(fishtokri, t)).toBe("Pre-order cutoff (03:00 IST) has passed. Opens at 08:00.");
      expect(classifyPlacementAtOrderTime(fishtokri, at("wed", 8))).toBe("same_day");
    });
    it("Mon 19:00 → preorder (Mon is a pre-order day, no same-day)", () => {
      expect(classifyPlacementAtOrderTime(fishtokri, at("mon", 19))).toBe("preorder");
      expect(preorderDeliveryDateIST(fishtokri, at("mon", 19))).toBe(date("tue"));
    });
    it("Sun 19:00 → closed (Sun is not a pre-order day)", () => {
      expect(classifyPlacementAtOrderTime(fishtokri, at("sun", 19))).toBe("closed");
    });
    it("Tue 10:00 → same-day, 17:59 same-day, 18:00 preorder", () => {
      expect(classifyPlacementAtOrderTime(fishtokri, at("tue", 10))).toBe("same_day");
      expect(classifyPlacementAtOrderTime(fishtokri, at("tue", 17, 59))).toBe("same_day");
      expect(classifyPlacementAtOrderTime(fishtokri, at("tue", 18))).toBe("preorder");
    });
    it("labels: hours and next delivery", () => {
      expect(preorderHoursLabel(fishtokri)).toBe("6 PM–3 AM");
      expect(preorderStatusLabel(fishtokri, at("tue", 19))).toBe("Pre-order · next day");
      expect(preorderStatusLabel(fishtokri, at("wed", 1, 30))).toBe("Pre-order · next day");
      // Delivery times on: the real day, no "morning".
      const slots = { ...fishtokri, delivery_slots_enabled: true };
      expect(preorderStatusLabel(slots, at("tue", 19))).toBe("Pre-order · delivers tomorrow");
      expect(preorderStatusLabel(slots, at("wed", 1, 30))).toBe("Pre-order · delivers today");
    });
  });

  describe("the old 22:00 cutoff is unchanged", () => {
    const old = { ...fishtokri, preorder_cutoff_time: "22:00" };
    it("after close until 22:00, then closed; nothing after midnight", () => {
      expect(classifyPlacementAtOrderTime(old, at("tue", 19))).toBe("preorder");
      expect(classifyPlacementAtOrderTime(old, at("tue", 21, 59))).toBe("preorder");
      expect(classifyPlacementAtOrderTime(old, at("tue", 22))).toBe("closed");
      expect(classifyPlacementAtOrderTime(old, at("tue", 23, 30))).toBe("closed");
      expect(classifyPlacementAtOrderTime(old, at("wed", 1, 30))).toBe("closed");
      expect(closedSellerMessage(old, at("tue", 23))).toBe("Pre-order cutoff (22:00 IST) has passed. Try again tomorrow.");
    });
    it("non-order pre-order day: all day until 22:00, delivered next morning", () => {
      expect(classifyPlacementAtOrderTime(old, at("mon", 1))).toBe("preorder");
      expect(classifyPlacementAtOrderTime(old, at("mon", 12))).toBe("preorder");
      expect(classifyPlacementAtOrderTime(old, at("mon", 22, 30))).toBe("closed");
      expect(preorderDeliveryDateIST(old, at("mon", 12))).toBe(date("tue"));
      expect(preorderWindowDaysBack(old, at("mon", 12))).toBe(0);
    });
    it("before close on an order day: closed", () => {
      expect(classifyPlacementAtOrderTime(old, at("wed", 5))).toBe("closed");
      expect(closedSellerMessage(old, at("wed", 5))).toBe("Store not yet open for orders. Opens at 08:00.");
    });
  });

  // Founder spec (22 Oct): pre-orders 1 PM–2 AM every day, delivered only Tue and Sat mornings.
  const nomadic = {
    opens_at: "08:00",
    closes_at: "22:00",
    open_days: [] as string[],
    preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    accepts_preorder: true,
    preorder_opens_at: "13:00",
    preorder_cutoff_time: "02:00",
    delivery_days: ["tue", "sat"],
  };

  // Founder rule (22 Oct, later): pre-orders open all the time, paused only on delivery days
  // (Tue, Sat) from 2 AM to 1 PM. Same config; the off-window applies only on delivery days.
  describe("The Nomadic Catch (open all week, paused Tue + Sat 2 AM–1 PM, delivery Tue + Sat)", () => {
    const cases: [string, number, number, "preorder" | "closed", string | null][] = [
      // [day, hh, mm, placement, delivery date]: Tue 16, Sat 20, next Tue 23 Jan
      ["mon", 15, 0, "preorder", "2024-01-16"],
      ["tue", 1, 59, "preorder", "2024-01-16"],
      ["tue", 2, 30, "preorder", "2024-01-20"], // after Tue's cutoff: next delivery day (founder, 25 Oct)
      ["tue", 13, 0, "preorder", "2024-01-20"],
      ["wed", 4, 0, "preorder", "2024-01-20"],
      ["fri", 23, 0, "preorder", "2024-01-20"],
      ["sat", 1, 0, "preorder", "2024-01-20"],
      ["sat", 2, 1, "preorder", "2024-01-23"],
      ["sat", 12, 59, "preorder", "2024-01-23"],
      ["sat", 13, 0, "preorder", "2024-01-23"],
      ["sun", 6, 0, "preorder", "2024-01-23"],
      ["mon", 3, 0, "preorder", "2024-01-16"],
      // earlier cases still hold
      ["sat", 14, 0, "preorder", "2024-01-23"],
      ["mon", 23, 0, "preorder", "2024-01-16"],
      ["tue", 1, 30, "preorder", "2024-01-16"],
      ["tue", 13, 30, "preorder", "2024-01-20"],
      ["sat", 1, 59, "preorder", "2024-01-20"],
      ["sat", 13, 1, "preorder", "2024-01-23"],
      // non-delivery days are open around the clock
      ["wed", 2, 0, "preorder", "2024-01-20"],
      ["thu", 10, 0, "preorder", "2024-01-20"],
      ["sun", 12, 59, "preorder", "2024-01-23"],
    ];
    for (const [day, hh, mm, kind, deliver] of cases) {
      it(`${day} ${hh}:${String(mm).padStart(2, "0")} → ${kind}${deliver ? `, delivers ${deliver}` : ""}`, () => {
        const t = at(day, hh, mm);
        expect(classifyPlacementAtOrderTime(nomadic, t)).toBe(kind);
        expect(preorderDeliveryDateIST(nomadic, t)).toBe(deliver);
      });
    }
    it("never same-day", () => {
      expect(classifyPlacementAtOrderTime(nomadic, at("wed", 10))).toBe("preorder");
      expect(classifyPlacementAtOrderTime(nomadic, at("tue", 10))).toBe("preorder");
      expect(isSellerEffectivelyOpen(nomadic, at("wed", 10))).toBe(false);
    });
    it("labels: always a pre-order line with the next delivery day", () => {
      expect(pausesOnlyOnDeliveryDays(nomadic)).toBe(true);
      expect(preorderPauseLabel(nomadic)).toBe("paused Tue & Sat 2 AM–1 PM");
      expect(preorderStatusLabel(nomadic, at("sun", 6))).toBe("Pre-order · delivers Tue");
      expect(preorderStatusLabel(nomadic, at("tue", 13, 30))).toBe("Pre-order · delivers Sat");
      expect(preorderStatusLabel(nomadic, at("wed", 4))).toBe("Pre-order · delivers Sat");
      expect(preorderStatusLabel(nomadic, at("mon", 23))).toBe("Pre-order · delivers tomorrow");
      expect(preorderStatusLabel(nomadic, at("tue", 2, 30))).toBe("Pre-order · delivers Sat");
      expect(preorderStatusLabel(nomadic, at("sat", 12, 59))).toBe("Pre-order · delivers Tue");
      const noDelivery = { ...nomadic, delivery_days: null, preorder_days: ["fri"] };
      expect(closedSellerMessage(noDelivery, at("fri", 10))).toBe("Not taking orders right now. Pre-orders open at 1 PM.");
    });
    it("without delivery_days the 2 AM–1 PM off-window still applies every day", () => {
      const daily = { ...nomadic, delivery_days: null };
      expect(pausesOnlyOnDeliveryDays(daily)).toBe(false);
      expect(preorderPauseLabel(daily)).toBeNull();
      expect(classifyPlacementAtOrderTime(daily, at("wed", 4))).toBe("closed");
      expect(classifyPlacementAtOrderTime(daily, at("wed", 13))).toBe("preorder");
      expect(preorderDeliveryDateIST(daily, at("wed", 13))).toBe(date("thu"));
      expect(preorderStatusLabel(daily, at("wed", 4))).toBe("Pre-orders open at 1 PM");
      expect(preorderStatusLabel(daily, at("wed", 13))).toBe("Pre-order · next day");
    });
    it("Fishtokri is unchanged, even with delivery days set (it has same-day days)", () => {
      for (const s of [fishtokri, { ...fishtokri, delivery_days: ["wed"] }]) {
        expect(pausesOnlyOnDeliveryDays(s)).toBe(false);
        expect(preorderPauseLabel(s)).toBeNull();
        expect(classifyPlacementAtOrderTime(s, at("tue", 10))).toBe("same_day");
        expect(classifyPlacementAtOrderTime(s, at("tue", 18))).toBe("preorder");
        expect(classifyPlacementAtOrderTime(s, at("wed", 1, 30))).toBe("preorder");
        expect(classifyPlacementAtOrderTime(s, at("wed", 3, 30))).toBe("closed");
        expect(classifyPlacementAtOrderTime(s, at("sun", 19))).toBe("closed");
        expect(classifyPlacementAtOrderTime(s, at("mon", 19))).toBe("preorder");
      }
      expect(preorderStatusLabel(fishtokri, at("tue", 19))).toBe("Pre-order · next day");
      expect(preorderDeliveryDateIST(fishtokri, at("wed", 1, 30))).toBe(date("wed"));
    });
    it("never closes: the seller page stays in pre-order mode through the delivery morning", () => {
      for (const [hh, mm] of [[2, 30], [8, 0], [12, 59], [13, 0]]) expect(classifyPlacementAtOrderTime(nomadic, at("tue", hh, mm))).toBe("preorder");
      expect(nextModeBoundaryMs(nomadic, at("tue", 2, 30))).toBeLessThanOrEqual(at("tue", 8));
    });
  });

  describe("Nomadic, earlier spec (pre-order days Tue + Sat till 3 AM, no start time)", () => {
    const v1 = { ...nomadic, preorder_days: ["tue", "sat"], preorder_opens_at: null, delivery_days: null, preorder_cutoff_time: "03:00" };
    const cases: [string, number, number, "preorder" | "closed"][] = [
      ["tue", 10, 0, "preorder"],
      ["wed", 2, 0, "preorder"],
      ["wed", 4, 0, "closed"],
      ["fri", 23, 0, "closed"],
      ["sat", 23, 59, "preorder"],
      ["sun", 2, 59, "preorder"],
    ];
    for (const [day, hh, mm, kind] of cases) {
      it(`${day} ${hh}:${String(mm).padStart(2, "0")} → ${kind}`, () => {
        expect(classifyPlacementAtOrderTime(v1, at(day, hh, mm))).toBe(kind);
      });
    }
    it("Wed 02:00 (Tue window) delivers Wed morning", () => {
      expect(preorderDeliveryDateIST(v1, at("wed", 2))).toBe(date("wed"));
      expect(preorderDeliveryDateIST(v1, at("tue", 10))).toBe(date("wed"));
    });
  });
});
