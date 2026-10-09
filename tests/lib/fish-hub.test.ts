import { describe, it, expect } from "vitest";
import { perKgRange, hubRows } from "../../src/lib/fish-hub";

const kg = (price: number, bundle_size = 1, extra = {}) => ({ id: "o", unit: "kg", price, bundle_size, ...extra }) as any;

describe("perKgRange", () => {
  it("converts weight packs to ₹/kg and ignores piece pricing", () => {
    const r = perKgRange([{ is_available: true, weight_avail: 5, pricing_options: [kg(690, 0.25), kg(1200), { id: "p", unit: "piece", price: 300, bundle_size: 1 } as any] }]);
    expect(r).toEqual({ low: 1200, high: 2760 });
  });
  it("pre-order only: the regular price, not the range (range max only if no price is set)", () => {
    expect(perKgRange([{ is_available: false, is_preorder_enabled: true, pricing_options: [kg(1000, 1, { preorder_price_min: 900, preorder_price_max: 1100 })] }])).toEqual({ low: 1000, high: 1000 });
    expect(perKgRange([{ is_available: false, is_preorder_enabled: true, pricing_options: [kg(0, 1, { preorder_price_min: 900, preorder_price_max: 1100 })] }])).toEqual({ low: 1100, high: 1100 });
  });
  it("is null when the fish is only sold by the piece", () => {
    expect(perKgRange([{ is_available: true, weight_avail: 3, pricing_options: [{ id: "p", unit: "piece", price: 300, bundle_size: 1 } as any] }])).toBeNull();
  });
});

describe("hubRows", () => {
  it("names the seller's area from coordinates before the profile text", () => {
    const rows = hubRows(
      [{ id: "s1", name: "Fishtokri.com", location_name: "Mumbai", lat: 19.19, lng: 72.98 }],
      [{ seller_id: "s1", species: "surmai", is_available: true, weight_avail: 2, pricing_options: [kg(1200)] }] as any,
      "surmai",
    );
    expect(rows[0].area).toBe("Thane");
    expect(rows[0].perKg).toEqual({ low: 1200, high: 1200 });
  });
});
