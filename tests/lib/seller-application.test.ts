import { describe, expect, it } from "vitest";
import { cleanSellerApplication, deliveryFeeUpdates, hasSellerApplied } from "../../src/lib/seller-application";

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
  const ok = { fish_sold: "prawns", areas_served: "Majiwada", fssai: "11523456789012" };
  it("needs fish sold, areas served and a 14-digit FSSAI number", () => {
    expect(cleanSellerApplication(null)).toHaveProperty("error");
    expect(cleanSellerApplication({ ...ok, fish_sold: "  " })).toHaveProperty("error");
    expect(cleanSellerApplication({ ...ok, areas_served: "" })).toHaveProperty("error");
    expect(cleanSellerApplication({ ...ok, fssai: "" })).toHaveProperty("error");
    expect(cleanSellerApplication({ ...ok, fssai: "12345" })).toHaveProperty("error");
    expect(cleanSellerApplication({ ...ok, fssai: "115234567890123" })).toHaveProperty("error");
    expect(cleanSellerApplication({ ...ok, fssai: 11523456789012 })).toHaveProperty("error");
  });
  it("trims, collapses spaces and caps length", () => {
    expect(cleanSellerApplication({ fish_sold: " pomfret,\n surmai ", areas_served: "Majiwada,  Manpada", fssai: "1152 3456 7890 12" }))
      .toEqual({ fish_sold: "pomfret, surmai", areas_served: "Majiwada, Manpada", fssai: "11523456789012" });
    expect((cleanSellerApplication({ ...ok, fish_sold: "x".repeat(5000) }) as any).fish_sold).toHaveLength(300);
  });
});

describe("deliveryFeeUpdates", () => {
  it("maps each choice to the delivery_fee_* columns", () => {
    expect(deliveryFeeUpdates("free", "40", "", "500")).toEqual({ delivery_fee_enabled: false, delivery_fee_type: "fixed", delivery_fee_amount: 0, delivery_fee_per_km: 0, free_delivery_above: 0 });
    expect(deliveryFeeUpdates("fixed", "40", "", "")).toEqual({ delivery_fee_enabled: true, delivery_fee_type: "fixed", delivery_fee_amount: 40, delivery_fee_per_km: 0, free_delivery_above: 0 });
    expect(deliveryFeeUpdates("per_km", "", "10", "500")).toEqual({ delivery_fee_enabled: true, delivery_fee_type: "per_km", delivery_fee_amount: 0, delivery_fee_per_km: 10, free_delivery_above: 500 });
  });
  it("rejects no choice, a missing or bad amount, and a negative free-above", () => {
    expect(deliveryFeeUpdates(undefined, "", "", "")).toHaveProperty("error");
    expect(deliveryFeeUpdates("fixed", "", "", "")).toHaveProperty("error");
    expect(deliveryFeeUpdates("fixed", "abc", "", "")).toHaveProperty("error");
    expect(deliveryFeeUpdates("per_km", "", "0", "")).toHaveProperty("error");
    expect(deliveryFeeUpdates("fixed", "40", "", "-1")).toHaveProperty("error");
  });
});
