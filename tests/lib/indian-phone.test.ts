import { describe, it, expect } from "vitest";
import { normalizeIndianMobile } from "../../src/lib/indian-phone";

describe("normalizeIndianMobile", () => {
  it("accepts 10-digit Indian mobile", () => {
    expect(normalizeIndianMobile("9876543210")).toEqual({ ok: true, digits10: "9876543210" });
  });
  it("accepts +91 prefix", () => {
    expect(normalizeIndianMobile("+91 98765 43210")).toEqual({ ok: true, digits10: "9876543210" });
  });
  it("rejects invalid start digit", () => {
    const r = normalizeIndianMobile("5876543210");
    expect(r.ok).toBe(false);
  });
  it("rejects short numbers", () => {
    expect(normalizeIndianMobile("987654321").ok).toBe(false);
  });
});
