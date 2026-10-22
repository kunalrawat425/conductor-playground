import { describe, it, expect } from "vitest";
import {
  checkDeliverySlot, deliveryDaysAt, deliverySlotsAt, orderDeliveryDateIST, orderSlotText, preorderDeliveryDates,
  sellerSlotError, slotLabel, slotSettingsError, slotTimeLabel, tomorrowPreorders, type SlotSeller,
} from "../../src/lib/delivery-slots";
import { preorderStatusLabel } from "../../src/lib/order-timing";

const ist = (s: string) => Date.parse(`${s}+05:30`); // "2026-10-22T10:15:00" (Thu)
const times = (slots: { start: string; end: string }[]) => slots.map((s) => slotTimeLabel(s.start, s.end));
const day = (iso: string) => slotLabel(iso, iso).split(",")[0];
/** The picker as the buyer sees it: ["Today", "Fri 23 Oct", …] (Today = same-day). */
const picker = (s: SlotSeller, at: string) => deliveryDaysAt(s, ist(at)).map((d) => (d.kind === "same_day" ? "Today" : day(d.slots[0].start)));
const today = (s: SlotSeller, at: string) => times(deliveryDaysAt(s, ist(at)).find((d) => d.kind === "same_day")?.slots || []);

// Fishtokri: same-day Tue–Sun 8 AM–6 PM, pre-orders Mon–Sat until 3 AM, delivered next morning.
const fishtokri: SlotSeller = {
  opens_at: "08:00", closes_at: "18:00", open_days: ["tue", "wed", "thu", "fri", "sat", "sun"],
  accepts_preorder: true, preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat"], preorder_cutoff_time: "03:00",
  preorder_opens_at: null, delivery_days: null,
  delivery_slots_enabled: true, delivery_slot_minutes: 120, preorder_delivery_start: "07:00", preorder_delivery_end: "13:00",
};
const fishtokri3 = { ...fishtokri, preorder_days_ahead: 3 };
// The Nomadic Catch: pre-order only, delivers Tue & Sat, paused 2 AM–1 PM on delivery days.
const nomadic: SlotSeller = {
  opens_at: "08:00", closes_at: "22:00", open_days: [], accepts_preorder: true,
  preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], preorder_opens_at: "13:00", preorder_cutoff_time: "02:00",
  delivery_days: ["tue", "sat"], delivery_slots_enabled: true, delivery_slot_minutes: 120,
};

describe("the day picker (Today = same-day, later days = pre-order)", () => {
  it("Fishtokri Thu 11 AM, 3 days ahead: Today + Fri, Sat, Sun (no Mon: no Sunday pre-orders)", () => {
    expect(picker(fishtokri3, "2026-10-22T11:00:00")).toEqual(["Today", "Fri 23 Oct", "Sat 24 Oct", "Sun 25 Oct"]);
    expect(deliveryDaysAt(fishtokri3, ist("2026-10-22T11:00:00")).map((d) => d.kind)).toEqual(["same_day", "preorder", "preorder", "preorder"]);
  });
  it("Fishtokri Thu 7 PM: no Today; tomorrow stays until the 3 AM cutoff", () => {
    expect(picker(fishtokri3, "2026-10-22T19:00:00")).toEqual(["Fri 23 Oct", "Sat 24 Oct", "Sun 25 Oct"]);
    expect(picker(fishtokri3, "2026-10-23T02:59:00")).toEqual(["Fri 23 Oct", "Sat 24 Oct", "Sun 25 Oct"]);
  });
  it("Fishtokri Fri 4 AM: this morning is gone, later days stay", () => {
    expect(picker(fishtokri3, "2026-10-23T04:00:00")).toEqual(["Sat 24 Oct", "Sun 25 Oct", "Tue 27 Oct"]);
  });
  it("default 1 day ahead: only the next delivery day", () => {
    expect(picker(fishtokri, "2026-10-22T11:00:00")).toEqual(["Today", "Fri 23 Oct"]);
    expect(picker(fishtokri, "2026-10-23T04:00:00")).toEqual(["Sat 24 Oct"]);
  });
  it("Nomadic: Tue & Sat only; fully closed during the delivery-morning pause", () => {
    expect(picker(nomadic, "2026-10-22T15:00:00")).toEqual(["Sat 24 Oct"]);
    expect(picker({ ...nomadic, preorder_days_ahead: 3 }, "2026-10-22T15:00:00")).toEqual(["Sat 24 Oct", "Tue 27 Oct", "Sat 31 Oct"]);
    expect(picker({ ...nomadic, preorder_days_ahead: 2 }, "2026-10-24T09:00:00")).toEqual([]); // Sat pause
    expect(picker(nomadic, "2026-10-24T01:30:00")).toEqual(["Sat 24 Oct"]); // before the 2 AM cutoff
    expect(preorderDeliveryDates({ ...nomadic, preorder_days_ahead: 2 }, ist("2026-10-22T15:00:00"))).toEqual(["2026-10-24", "2026-10-27"]);
  });
  it("Nomadic prod settings (2 delivery days ahead): always the next Tue and Sat", () => {
    const n2 = { ...nomadic, preorder_days_ahead: 2, preorder_delivery_start: "07:00", preorder_delivery_end: "13:00" };
    expect(picker(n2, "2026-10-28T11:00:00")).toEqual(["Sat 31 Oct", "Tue 3 Nov"]); // Wed
    expect(picker(n2, "2026-10-27T14:00:00")).toEqual(["Sat 31 Oct", "Tue 3 Nov"]); // Tue after the pause
    expect(picker(n2, "2026-10-25T11:00:00")).toEqual(["Tue 27 Oct", "Sat 31 Oct"]); // Sun
    expect(picker(n2, "2026-10-27T01:30:00")).toEqual(["Tue 27 Oct", "Sat 31 Oct"]); // Tue before the 2 AM cutoff
    // Tue pause 2 AM–1 PM: closed, as live today.
    expect(picker(n2, "2026-10-27T02:00:00")).toEqual([]);
    expect(picker(n2, "2026-10-27T10:00:00")).toEqual([]);
    expect(preorderStatusLabel(n2, ist("2026-10-27T10:00:00"))).toMatch(/^Pre-orders reopen at 1 PM/);
    expect(picker(n2, "2026-10-27T12:59:00")).toEqual([]);
    expect(picker(n2, "2026-10-27T13:00:00")).toEqual(["Sat 31 Oct", "Tue 3 Nov"]);
    expect(times(deliveryDaysAt(n2, ist("2026-10-28T11:00:00"))[0].slots)).toEqual(["7–9 AM", "9–11 AM", "11 AM–1 PM"]);
  });
  it("slots off = no picker (checkout as before)", () => {
    expect(deliveryDaysAt({ ...fishtokri, delivery_slots_enabled: false }, ist("2026-10-22T11:00:00"))).toEqual([]);
  });
});

describe("Today's slots", () => {
  it("start at least 2 hours out, rounded up to a slot boundary", () => {
    expect(today(fishtokri, "2026-10-22T10:15:00")).toEqual(["2–4 PM", "4–6 PM"]);
    expect(today(fishtokri, "2026-10-22T08:00:00")).toEqual(["10 AM–12 PM", "12–2 PM", "2–4 PM", "4–6 PM"]);
  });
  it("1-hour slots end at closing time", () => {
    expect(today({ ...fishtokri, delivery_slot_minutes: 60 }, "2026-10-22T10:15:00")).toEqual(["1–2 PM", "2–3 PM", "3–4 PM", "4–5 PM", "5–6 PM"]);
  });
  it("no Today within 2 hours of closing", () => {
    expect(picker(fishtokri, "2026-10-22T16:30:00")).toEqual(["Fri 23 Oct"]);
  });
});

describe("pre-order slots", () => {
  it("run in the pre-order delivery window", () => {
    const slots = deliverySlotsAt(fishtokri, ist("2026-10-22T20:00:00"));
    expect(times(slots)).toEqual(["7–9 AM", "9–11 AM", "11 AM–1 PM"]);
    expect(times(deliverySlotsAt({ ...nomadic, preorder_delivery_start: "06:00", preorder_delivery_end: "10:00" }, ist("2026-10-22T15:00:00"))))
      .toEqual(["6–8 AM", "8–10 AM"]);
  });
});

describe("checkDeliverySlot (order create)", () => {
  const now = ist("2026-10-22T10:15:00");
  const offered = deliveryDaysAt(fishtokri, now)[0].slots[0];
  it("accepts a slot the seller offers now, with a little grace; the day decides the kind", () => {
    expect(checkDeliverySlot(fishtokri, "delivery", offered.start, now)).toEqual({ slot: offered, kind: "same_day" });
    expect(checkDeliverySlot(fishtokri, "delivery", offered.start, now + 10 * 60_000).slot).toEqual(offered);
    const friday = new Date(ist("2026-10-23T09:00:00")).toISOString();
    expect(checkDeliverySlot(fishtokri, "delivery", friday, now).kind).toBe("preorder");
  });
  it("rejects a missing, past or made-up slot", () => {
    expect(checkDeliverySlot(fishtokri, "delivery", null, now).error).toMatch(/Pick a delivery time/);
    expect(checkDeliverySlot(fishtokri, "delivery", new Date(ist("2026-10-22T10:00:00")).toISOString(), now).error).toMatch(/no longer available/);
    expect(checkDeliverySlot(fishtokri, "delivery", new Date(ist("2026-10-22T14:30:00")).toISOString(), now).error).toBeTruthy();
  });
  it("pickup, or slots off: no slot, no error", () => {
    expect(checkDeliverySlot(fishtokri, "pickup", null, now)).toEqual({ slot: null });
    expect(checkDeliverySlot({ ...fishtokri, delivery_slots_enabled: false }, "delivery", null, now)).toEqual({ slot: null });
  });
  it("a later delivery day is valid only within days ahead", () => {
    const t = ist("2026-10-22T20:00:00");
    const sunday = new Date(ist("2026-10-25T09:00:00")).toISOString();
    expect(checkDeliverySlot(fishtokri3, "delivery", sunday, t).slot).toBeTruthy();
    expect(checkDeliverySlot(fishtokri, "delivery", sunday, t).error).toBeTruthy();
  });
});


describe("labels and seller edits", () => {
  const start = new Date(ist("2026-10-25T09:00:00")).toISOString();
  const end = new Date(ist("2026-10-25T11:00:00")).toISOString();
  it("slot text for buyers", () => {
    expect(slotLabel(start, end)).toBe("Sun 25 Oct, 9–11 AM");
    expect(orderSlotText({ status: "confirmed", delivery_slot_start: start, delivery_slot_end: end })).toEqual({ label: "Delivery slot", value: "Sun 25 Oct, 9–11 AM" });
    expect(orderSlotText({ status: "out_for_delivery", delivery_slot_start: start, delivery_slot_end: end })).toEqual({ label: "Arriving by", value: "11 AM" });
    expect(orderSlotText({ status: "confirmed" })).toBeNull();
  });
  it("delivery date follows the slot, not the order time", () => {
    expect(orderDeliveryDateIST({ delivery_slot_start: start, is_preorder: true, created_at: new Date(ist("2026-10-22T20:00:00")).toISOString() }, fishtokri)).toBe("2026-10-25");
    expect(orderDeliveryDateIST({ is_preorder: true, created_at: new Date(ist("2026-10-22T20:00:00")).toISOString() }, fishtokri)).toBe("2026-10-23");
    expect(orderDeliveryDateIST({ is_preorder: false, created_at: new Date(ist("2026-10-22T10:00:00")).toISOString() }, fishtokri)).toBeNull();
  });
  it("seller slot / arriving-by checks", () => {
    const now = ist("2026-10-25T08:00:00");
    expect(sellerSlotError({ start, end }, now)).toBeNull();
    expect(sellerSlotError({ start: end, end: start }, now)).toBeTruthy();
    expect(sellerSlotError({ start, end: new Date(ist("2026-10-25T18:00:00")).toISOString() }, now)).toMatch(/6 hours/);
    expect(sellerSlotError({ start, end }, ist("2026-10-26T08:00:00"))).toMatch(/from now on/);
  });
  it("settings checks", () => {
    expect(slotSettingsError({ delivery_slot_minutes: 120, preorder_delivery_start: "07:00", preorder_delivery_end: "13:00", preorder_days_ahead: 3 })).toBeNull();
    expect(slotSettingsError({ delivery_slot_minutes: 90 })).toMatch(/1 or 2 hours/);
    expect(slotSettingsError({ preorder_delivery_start: "13:00", preorder_delivery_end: "07:00" })).toMatch(/end after/);
    expect(slotSettingsError({ preorder_days_ahead: 4 })).toMatch(/1, 2 or 3/);
  });
});

describe("tomorrowPreorders (seller push the evening before)", () => {
  it("counts carts due tomorrow and finds the first slot", () => {
    const iso = (s: string) => new Date(ist(s)).toISOString();
    const orders = [
      { id: "a", cart_id: "c1", is_preorder: true, delivery_slot_start: iso("2026-10-23T11:00:00"), delivery_slot_end: iso("2026-10-23T13:00:00") },
      { id: "b", cart_id: "c1", is_preorder: true, delivery_slot_start: iso("2026-10-23T11:00:00"), delivery_slot_end: iso("2026-10-23T13:00:00") },
      { id: "c", is_preorder: true, delivery_slot_start: iso("2026-10-23T07:00:00"), delivery_slot_end: iso("2026-10-23T09:00:00") },
      { id: "d", is_preorder: true, created_at: iso("2026-10-22T19:00:00") }, // no slot: next morning
      { id: "e", is_preorder: true, delivery_slot_start: iso("2026-10-25T07:00:00"), delivery_slot_end: iso("2026-10-25T09:00:00") },
    ];
    expect(tomorrowPreorders(orders, fishtokri, ist("2026-10-22T20:00:00"))).toEqual({ count: 3, firstSlot: "7–9 AM" });
  });
});
