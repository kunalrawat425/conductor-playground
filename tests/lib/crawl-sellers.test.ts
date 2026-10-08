import { describe, expect, it } from "vitest";
import { buildCrawlSellers } from "../../src/lib/crawl-sellers";
import { sellerHref, sellerLookupOutcome } from "../../src/lib/seller-display";

describe("buildCrawlSellers (/shop crawlable list)", () => {
  const sellers = [
    { id: "a", name: "Fishtokri.com", location_name: "Thane West" },
    { id: "b", name: "No Stock Fish", location_name: "Kamothe" },
    { id: "c", name: "मासे", location_name: null },
  ];
  const listings = [
    { seller_id: "a", species: "surmai" },
    { seller_id: "a", species: "surmai" },
    { seller_id: "a", species: "pomfret" },
    { seller_id: "c", species: "bombil" },
  ];
  const out = buildCrawlSellers(sellers, listings);

  it("lists only sellers with an available listing", () => {
    expect(out.map((s) => s.href)).toEqual(["/s/fishtokri-com", "/seller/c"]);
  });
  it("dedupes species and keeps the raw-name slug link", () => {
    expect(out[0].href).toBe("/s/fishtokri-com");
    expect(out[0].species).toHaveLength(2);
    expect(out[0].location).toBe("Thane West");
  });
  it("handles empty input", () => {
    expect(buildCrawlSellers([], [])).toEqual([]);
  });
});

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
