import { describe, expect, it } from "vitest";
import { classifyPlacementAtOrderTime, preorderDeliveryDateIST } from "../../src/lib/order-timing";
import { deliveryDaysAt } from "../../src/lib/delivery-slots";

// Prod settings, 25 Oct 2026.
const FISHTOKRI: any = { opens_at: "08:00", closes_at: "18:00", open_days: ["tue", "wed", "thu", "fri", "sat", "sun"], preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat"], preorder_opens_at: null, preorder_cutoff_time: "03:00", delivery_days: null, preorder_delivery_start: "08:00", preorder_delivery_end: "18:00", delivery_slot_minutes: 120, preorder_days_ahead: 3, accepts_preorder: true, delivery_slots_enabled: true };
const NOMADIC: any = { opens_at: "08:00", closes_at: "22:00", open_days: [], preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], preorder_opens_at: "13:00", preorder_cutoff_time: "02:00", delivery_days: ["wed", "sun"], preorder_delivery_start: "09:00", preorder_delivery_end: "11:00", delivery_slot_minutes: 120, preorder_days_ahead: 2, accepts_preorder: true, delivery_slots_enabled: true };
const t = (s: string) => Date.parse(`${s}+05:30`);
const first = (s: any, at: string) => { const d = deliveryDaysAt(s, t(at))[0]; return d && `${d.kind} ${d.date}`; };

describe("never closed (founder, 25 Oct 2026)", () => {
  it("every hour of the week takes an order, for both sellers", () => {
    for (let h = 0; h < 24 * 7; h++) {
      const at = t("2026-10-26T00:00") + h * 3600_000;
      expect(classifyPlacementAtOrderTime(FISHTOKRI, at)).not.toBe("closed");
      expect(classifyPlacementAtOrderTime(NOMADIC, at)).not.toBe("closed");
      expect(deliveryDaysAt(FISHTOKRI, at).length).toBeGreaterThan(0);
      expect(deliveryDaysAt(NOMADIC, at).length).toBeGreaterThan(0);
    }
  });
  it("Fishtokri Tue 5 AM: same-day order for today's first slot (decision A)", () => {
    expect(classifyPlacementAtOrderTime(FISHTOKRI, t("2026-10-27T05:00"))).toBe("same_day");
    expect(first(FISHTOKRI, "2026-10-27T05:00")).toBe("same_day 2026-10-27");
  });
  it("Fishtokri Sun 7 PM: pre-order delivered Tuesday (no Monday delivery)", () => {
    expect(classifyPlacementAtOrderTime(FISHTOKRI, t("2026-10-25T19:00"))).toBe("preorder");
    expect(preorderDeliveryDateIST(FISHTOKRI, t("2026-10-25T19:00"))).toBe("2026-10-27");
    expect(first(FISHTOKRI, "2026-10-25T19:00")).toBe("preorder 2026-10-27");
  });
  it("Fishtokri 1 AM keeps last night's pre-order for this morning (before the 3 AM cutoff)", () => {
    expect(first(FISHTOKRI, "2026-10-28T01:00")).toBe("preorder 2026-10-28");
  });
  it("Nomadic Sun 10 AM (after the 2 AM cutoff): next delivery Wed", () => {
    expect(classifyPlacementAtOrderTime(NOMADIC, t("2026-10-25T10:00"))).toBe("preorder");
    expect(first(NOMADIC, "2026-10-25T10:00")).toBe("preorder 2026-10-28");
  });
});
