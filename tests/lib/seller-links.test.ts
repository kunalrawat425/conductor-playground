import { describe, expect, it } from "vitest";
import { resizedImageUrl, sellerHref, sellerLookupOutcome } from "../../src/lib/seller-display";

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

describe("validateSellerName", () => {
  it("accepts real business names", async () => {
    const { validateSellerName } = await import("../../src/lib/seller-display");
    for (const n of ["Fishtokri", "Ram & Sons", "D'Souza Fish", "Sea-Fresh Fish 2", "मासे वाला", "Seller 0263"]) expect(validateSellerName(n)).toBeNull();
  });
  it("rejects domains, phone numbers, symbols and bad lengths", async () => {
    const { validateSellerName } = await import("../../src/lib/seller-display");
    for (const n of ["Fishtokri.com", "www.fish", "fish.in shop", "https://x", "Ram Fish 9876543210", "Ram 98765-43210", "Fish@Home", "Fish!!", "A", "x".repeat(61), "", null]) {
      expect(validateSellerName(n), String(n)).not.toBeNull();
    }
  });
});

describe("resizedImageUrl", () => {
  it("routes Supabase Storage photos through the image transform", () => {
    expect(resizedImageUrl("https://x.supabase.co/storage/v1/object/public/fish-photos/sellers/b.png", 800))
      .toBe("https://x.supabase.co/storage/v1/render/image/public/fish-photos/sellers/b.png?width=800&quality=70&resize=contain");
  });
  it("leaves other URLs and empty values alone", () => {
    expect(resizedImageUrl("https://www.relifish.com/fish/pomfret.jpg", 800)).toBe("https://www.relifish.com/fish/pomfret.jpg");
    expect(resizedImageUrl(null, 800)).toBeNull();
  });
});
