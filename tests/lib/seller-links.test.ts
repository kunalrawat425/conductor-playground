import { describe, expect, it } from "vitest";
import { sellerHref, sellerLookupOutcome } from "../../src/lib/seller-display";

describe("sellerHref", () => {
  it("uses /s/<slug> when the name has latin chars", () => {
    expect(sellerHref("Ocean Lovers Fish", "x")).toBe("/s/ocean-lovers-fish");
  });
  it("falls back to /seller/<id> when the slug would be empty", () => {
    expect(sellerHref("मासे", "id-1")).toBe("/seller/id-1");
    expect(sellerHref(null, "id-2")).toBe("/seller/id-2");
  });
});

describe("sellerLookupOutcome (404 vs 503)", () => {
  it("treats no-row and malformed uuid as not found", () => {
    expect(sellerLookupOutcome({ code: "PGRST116" })).toBe("not_found");
    expect(sellerLookupOutcome({ code: "22P02" })).toBe("not_found");
  });
  it("treats anything else as an outage so Google retries", () => {
    expect(sellerLookupOutcome({ code: "PGRST301" })).toBe("unavailable");
    expect(sellerLookupOutcome(new Error("fetch failed"))).toBe("unavailable");
    expect(sellerLookupOutcome(null)).toBe("unavailable");
  });
});
