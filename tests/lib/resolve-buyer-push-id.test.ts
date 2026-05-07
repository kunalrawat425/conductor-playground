import { describe, expect, it } from "vitest";
import { buyerPhoneLookupCandidates } from "../../src/lib/server/resolve-buyer-push-id";

describe("buyerPhoneLookupCandidates", () => {
  it("returns [] for null/empty", () => {
    expect(buyerPhoneLookupCandidates(null)).toEqual([]);
    expect(buyerPhoneLookupCandidates(undefined)).toEqual([]);
    expect(buyerPhoneLookupCandidates("")).toEqual([]);
    expect(buyerPhoneLookupCandidates("abc")).toEqual([]);
  });

  it("strips non-digits and adds last-10 and full digit string", () => {
    expect(buyerPhoneLookupCandidates("+91 98765 43210").sort()).toEqual(["9876543210", "919876543210"].sort());
  });

  it("handles 10-digit local", () => {
    const c = buyerPhoneLookupCandidates("9876543210");
    expect(c).toContain("9876543210");
    expect(c.length).toBe(1);
  });
});
