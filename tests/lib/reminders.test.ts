import { describe, expect, it } from "vitest";
import { abandonedCartBuyers, inReminderWindow, unpaidOrdersToRemind } from "../../src/lib/server/reminders";

const now = Date.parse("2026-10-20T10:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

describe("inReminderWindow (1–2h old, once per hourly run)", () => {
  it("includes 60..119 min old, excludes fresher and older", () => {
    expect(inReminderWindow(ago(60), now)).toBe(true);
    expect(inReminderWindow(ago(119), now)).toBe(true);
    expect(inReminderWindow(ago(59), now)).toBe(false);
    expect(inReminderWindow(ago(120), now)).toBe(false);
    expect(inReminderWindow("not a date", now)).toBe(false);
  });
});

describe("unpaidOrdersToRemind", () => {
  it("one reminder per checkout (cart lines share a minute), skips guests and out-of-window", () => {
    const t = ago(90);
    const rows = [
      { id: "a1", buyer_id: "b1", species: "surmai", created_at: t },
      { id: "a2", buyer_id: "b1", species: "pomfret", created_at: t },
      { id: "c1", buyer_id: null, species: "surmai", created_at: t },
      { id: "d1", buyer_id: "b2", species: "prawns", created_at: ago(30) },
    ];
    expect(unpaidOrdersToRemind(rows, now).map((r) => r.id)).toEqual(["a1"]);
  });
});

describe("abandonedCartBuyers", () => {
  it("reminds when the cart went quiet 1–2h ago and no order since", () => {
    const rows = [
      { buyer_id: "b1", created_at: ago(200), updated_at: ago(90) },
      { buyer_id: "b2", created_at: ago(90), updated_at: null },
      { buyer_id: "b3", created_at: ago(90), updated_at: null },
      { buyer_id: "b4", created_at: ago(90), updated_at: ago(10) },
    ];
    // b3 ordered after adding to cart -> no reminder; b4 still active -> no reminder
    expect(abandonedCartBuyers(rows, { b3: ago(70) }, now)).toEqual(["b1", "b2"]);
  });
});

describe("reminder guards", () => {
  it("never asks a buyer who already paid to pay again", async () => {
    const { unpaidOrdersToRemind } = await import("../../src/lib/server/reminders");
    const t = ago(90);
    const rows = [
      { id: "r", buyer_id: "b1", species: "surmai", created_at: t, razorpay_payment_id: "pay_x" },
      { id: "u", buyer_id: "b2", species: "surmai", created_at: t, payment_screenshot_urls: ["proof.jpg"] },
      { id: "v", buyer_id: "b3", species: "surmai", created_at: t, payment_verified_at: t },
      { id: "n", buyer_id: "b4", species: "surmai", created_at: t, payment_screenshot_urls: [] },
    ];
    expect(unpaidOrdersToRemind(rows, now).map((r) => r.id)).toEqual(["n"]);
  });
  it("fixed hourly windows and IST sending hours", async () => {
    const { windowNow, inSendingHours } = await import("../../src/lib/server/reminders");
    expect(windowNow(Date.parse("2026-10-20T10:47:13Z"))).toBe(Date.parse("2026-10-20T10:00:00Z"));
    expect(inSendingHours(Date.parse("2026-10-20T01:29:00Z"))).toBe(false); // 06:59 IST
    expect(inSendingHours(Date.parse("2026-10-20T01:30:00Z"))).toBe(true); // 07:00 IST
    expect(inSendingHours(Date.parse("2026-10-20T15:30:00Z"))).toBe(false); // 21:00 IST
  });
});

describe("test sellers on live", () => {
  it("inactive test sellers work on staging/previews but never on production", async () => {
    const { sellerBlocked } = await import("../../src/lib/test-sellers");
    const qa = { is_active: false, is_test: true };
    expect(sellerBlocked(qa, "preview")).toBe(false);
    expect(sellerBlocked(qa, undefined)).toBe(false); // local dev
    expect(sellerBlocked(qa, "production")).toBe(true);
    expect(sellerBlocked({ is_active: false, is_test: false }, "preview")).toBe(true);
    expect(sellerBlocked({ is_active: true }, "production")).toBe(false);
    expect(sellerBlocked(null, "production")).toBe(false);
  });
});

describe("pickPreferences (checkout prep choices)", () => {
  it("keeps only known cut styles, dedupes, caps notes", async () => {
    const { pickPreferences } = await import("../../src/lib/preferences");
    expect(pickPreferences("cleaned,cut,cleaned,evil", "  no head ")).toEqual({ cut_style: "cleaned,cut", buyer_notes: "no head" });
    expect(pickPreferences("", "")).toBeNull();
    expect(pickPreferences(42, { x: 1 })).toBeNull();
    expect(pickPreferences("whole", "a".repeat(900))?.buyer_notes).toHaveLength(500);
  });
});
