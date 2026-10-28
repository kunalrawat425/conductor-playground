import { describe, expect, it } from "vitest";
import { cleanSellerApplication, hasSellerApplied } from "../../src/lib/seller-application";

describe("hasSellerApplied", () => {
  it("is false for the sign-up placeholder or an empty area", () => {
    expect(hasSellerApplied(null)).toBe(false);
    expect(hasSellerApplied({ name: "Seller 4472", location_name: "" })).toBe(false);
    expect(hasSellerApplied({ name: "Seller 4472", location_name: "Thane West" })).toBe(false);
    expect(hasSellerApplied({ name: "Sai Fish Centre", location_name: " " })).toBe(false);
  });
  it("is true once they chose a shop name and gave an area", () => {
    expect(hasSellerApplied({ name: "Sai Fish Centre", location_name: "Thane West" })).toBe(true);
    expect(hasSellerApplied({ name: "Seller Koli 12", location_name: "Versova" })).toBe(true);
  });
});

describe("cleanSellerApplication", () => {
  it("needs the fish they sell", () => {
    expect(cleanSellerApplication({ fish_sold: "  " })).toHaveProperty("error");
    expect(cleanSellerApplication(null)).toHaveProperty("error");
  });
  it("trims, caps length and keeps FSSAI digits only when it is 14 digits", () => {
    expect(cleanSellerApplication({ fish_sold: " pomfret,\n surmai ", source_market: "Sassoon  Dock", fssai: "1152 3456 7890 12" }))
      .toEqual({ fish_sold: "pomfret, surmai", source_market: "Sassoon Dock", fssai: "11523456789012" });
    expect((cleanSellerApplication({ fish_sold: "x".repeat(5000) }) as any).fish_sold).toHaveLength(300);
    expect(cleanSellerApplication({ fish_sold: "prawns", fssai: "12345" })).toHaveProperty("error");
    expect(cleanSellerApplication({ fish_sold: "prawns", fssai: 123 })).toEqual({ fish_sold: "prawns", source_market: "", fssai: "" });
  });
});
