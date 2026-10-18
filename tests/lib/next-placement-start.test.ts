import { describe, it, expect } from "vitest";
import { nextPlacementStartMs } from "../../src/lib/cart";

// The closed banner on the seller page says when pre-orders open next; it must match the order API's rule.
const IST = 5.5 * 3600_000;
/** Mon 2024-01-15 at hh:mm IST, as epoch ms. */
const at = (hh: number, mm = 0, day = 15) => Date.UTC(2024, 0, day, hh, mm) - IST;
const ALL = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const base = { opens_at: "06:00", closes_at: "14:00", accepts_preorder: true, open_days: ALL, preorder_days: ALL, preorder_cutoff_time: "22:00" };

describe("nextPlacementStartMs", () => {
  it("before opening: pre-orders start at today's close", () => {
    expect(nextPlacementStartMs(base, "preorder", at(5))).toBe(at(14));
  });
  it("after cutoff: pre-orders start at tomorrow's close", () => {
    expect(nextPlacementStartMs(base, "preorder", at(22, 30))).toBe(at(14, 0, 16));
  });
  it("non-order day: pre-orders run from midnight", () => {
    expect(nextPlacementStartMs({ ...base, open_days: ALL.filter((d) => d !== "tue") }, "preorder", at(22, 30))).toBe(at(0, 0, 16));
  });
  it("pre-orders off: never", () => {
    expect(nextPlacementStartMs({ ...base, accepts_preorder: false, preorder_days: [] }, "preorder", at(5))).toBeNull();
  });
});
