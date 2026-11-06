import { describe, it, expect } from "vitest";
import { preorderDeliveryDates, deliveryDaysAt } from "../../src/lib/delivery-slots";
import { classifyPlacementAtOrderTime, isClosedDateMs } from "../../src/lib/order-timing";

// The Nomadic Catch, 6 Nov 2026: pre-order only, delivers Wed + Sun, closed Sun 8 and Wed 11 Nov.
const nomadic = {
  opens_at: "08:00", closes_at: "22:00", open_days: [], accepts_preorder: true,
  preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], preorder_opens_at: "13:00", preorder_cutoff_time: "02:00",
  delivery_days: ["wed", "sun"], delivery_slots_enabled: true, delivery_slot_minutes: 120,
  preorder_delivery_start: "07:00", preorder_delivery_end: "13:00", preorder_days_ahead: 1,
};
const fri2pm = Date.parse("2026-11-06T14:00:00+05:30");

describe("closed dates", () => {
  it("skips closed delivery days: the first pre-order date is Sun 15 Nov", () => {
    expect(preorderDeliveryDates(nomadic, fri2pm)).toEqual(["2026-11-08"]);
    const closed = { ...nomadic, closed_dates: ["2026-11-08", "2026-11-11"] };
    expect(preorderDeliveryDates(closed, fri2pm)).toEqual(["2026-11-15"]);
    expect(preorderDeliveryDates({ ...closed, preorder_days_ahead: 2 }, fri2pm)).toEqual(["2026-11-15", "2026-11-18"]);
    const days = deliveryDaysAt(closed, fri2pm);
    expect(days.map((d) => d.date)).toEqual(["2026-11-15"]);
    expect(days[0].slots.length).toBeGreaterThan(0);
  });
  it("the shop stays open for pre-orders meanwhile", () => {
    expect(classifyPlacementAtOrderTime({ ...nomadic, closed_dates: ["2026-11-08", "2026-11-11"] }, fri2pm)).toBe("preorder");
  });
  it("a closed day has no same-day orders", () => {
    const shop = { opens_at: "08:00", closes_at: "18:00", open_days: ["fri"], accepts_preorder: false };
    expect(classifyPlacementAtOrderTime(shop, fri2pm)).toBe("same_day");
    expect(isClosedDateMs({ closed_dates: ["2026-11-06"] }, fri2pm)).toBe(true);
    expect(classifyPlacementAtOrderTime({ ...shop, closed_dates: ["2026-11-06"] }, fri2pm)).not.toBe("same_day");
  });
});
