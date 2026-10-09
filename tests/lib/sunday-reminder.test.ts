import { describe, it, expect } from "vitest";
import { planSundayReminders, preorderOpenUntil, timeLabel, type ReminderSeller } from "../../src/lib/server/sunday-reminder";

const ALL = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
// 17:00 IST on any date (11:30 UTC); day-of-week checks use every day so the test is date-independent.
const at = (hhmm: string) => { const d = new Date(); const [h, m] = hhmm.split(":").map(Number); d.setUTCHours(h - 5, m - 30, 0, 0); return d.getTime(); };
const NOW = at("17:00");

const seller = (o: Partial<ReminderSeller>): ReminderSeller => ({
  id: "s1", name: "Fishy Spot", lat: 19.02, lng: 73.09, delivery_rad: 5,
  opens_at: "01:00", closes_at: "01:01", open_days: ALL, accepts_preorder: true, preorder_days: ALL, preorder_cutoff_time: "23:59",
  has_preorder_listing: true, has_sameday_listing: true, ...o,
});
const near = { id: "b1", lat: 19.03, lng: 73.09 };

describe("preorderOpenUntil", () => {
  it("is null when the cutoff equals closing time (no pre-order window at all)", () => {
    expect(preorderOpenUntil(seller({ opens_at: "08:00", closes_at: "18:00", preorder_cutoff_time: "18:00" }), at("16:00"))).toBeNull();
  });
  it("finds the window when the shop is closed and the cutoff is later", () => {
    expect(preorderOpenUntil(seller({}), NOW)).not.toBeNull();
  });
});

describe("planSundayReminders", () => {
  it("pre-order message for a nearby seller with an open pre-order window, linking to the seller", () => {
    const [p] = planSundayReminders([near], [seller({})], NOW);
    expect(p.title).toMatch(/Pre-order/);
    expect(p.body).toBe("Fishy Spot is taking pre-orders for Sunday until 11:59 PM tonight.");
    expect(p.path).toMatch(/^\/(s|seller)\//);
    expect(p.body).not.toMatch(/₹|\d+\s*\/?kg/);
  });

  it("falls back to 'open tomorrow' when pre-orders are not possible but the shop opens Sunday", () => {
    const s = seller({ opens_at: "08:00", closes_at: "18:00", preorder_cutoff_time: "18:00" });
    const [p] = planSundayReminders([near], [s], at("17:00"));
    expect(p.body).toBe("Fishy Spot is open tomorrow from 8 AM.");
    expect(p.title).not.toMatch(/Pre-order/);
  });

  it("skips buyers outside every seller's radius, without location, or with a recent promo", () => {
    const s = seller({});
    expect(planSundayReminders([{ id: "far", lat: 19.25, lng: 72.97 }], [s], NOW)).toEqual([]);
    expect(planSundayReminders([{ id: "noloc", lat: null, lng: null }], [s], NOW)).toEqual([]);
    expect(planSundayReminders([{ ...near, last_promo_push_sent_at: new Date(NOW - 3_600_000).toISOString() }], [s], NOW)).toEqual([]);
  });

  it("skips sellers closed on Sunday with no pre-order, and sellers with nothing listed", () => {
    expect(planSundayReminders([near], [seller({ accepts_preorder: false, open_days: ["mon"] })], NOW)).toEqual([]);
    expect(planSundayReminders([near], [seller({ has_preorder_listing: false, has_sameday_listing: false })], NOW)).toEqual([]);
  });

  it("two nearby sellers: one push, both named, links to /shop", () => {
    const p = planSundayReminders([near], [seller({}), seller({ id: "s2", name: "Bombay Sea Food" })], NOW);
    expect(p).toHaveLength(1);
    expect(p[0].path).toBe("/shop");
    expect(p[0].sellerIds).toEqual(["s1", "s2"]);
  });
});

describe("timeLabel", () => {
  it("formats 24h times", () => {
    expect(timeLabel("22:00:00")).toBe("10 PM");
    expect(timeLabel("08:00")).toBe("8 AM");
    expect(timeLabel("18:30")).toBe("6:30 PM");
    expect(timeLabel("00:15")).toBe("12:15 AM");
  });
});
