import { describe, it, expect } from "vitest";
import {
  canonicalPricingOptionsFromPayload,
  validateListingPricingJson,
  getListingPriceOptions,
  optionHasDealDisplay,
  optionDiscountPercentDisplay,
  formatInventoryAmount,
  maxOrderQtyFromStock,
  stockQuantityInputStep,
  pricingOptionsUniformUnit,
} from "../../src/lib/listing-pricing";

describe("canonicalPricingOptionsFromPayload", () => {
  it("maps legacy dozen to piece", () => {
    expect(
      canonicalPricingOptionsFromPayload([{ id: "k", label: "Per dozen", price: 300, unit: "dozen" }])![0].unit
    ).toBe("piece");
  });

  it("normalizes kg and g to gram", () => {
    expect(
      canonicalPricingOptionsFromPayload([{ id: "k", label: "A", price: 400, unit: "kg" }])![0].unit
    ).toBe("kg");
    expect(
      canonicalPricingOptionsFromPayload([{ id: "g", label: "B", price: 2, unit: "g" }])![0].unit
    ).toBe("gram");
  });

  it("parses valid tiers and drops invalid rows", () => {
    const out = canonicalPricingOptionsFromPayload([
      { id: "a", label: "Large", price: 100, unit: "piece" },
      { id: "b", label: "Bad", price: 0, unit: "piece" },
    ]);
    expect(out).toHaveLength(1);
    expect(out![0].id).toBe("a");
    expect(out![0].price).toBe(100);
  });

  it("returns null for empty or invalid", () => {
    expect(canonicalPricingOptionsFromPayload(null)).toBeNull();
    expect(canonicalPricingOptionsFromPayload([])).toBeNull();
    expect(canonicalPricingOptionsFromPayload([{ price: 0 }])).toBeNull();
  });

  it("stores compare_at_price when higher than selling price", () => {
    const out = canonicalPricingOptionsFromPayload([
      { id: "a", label: "Deal", price: 80, unit: "piece", compare_at_price: 100 },
    ]);
    expect(out![0].compare_at_price).toBe(100);
  });

  it("drops compare_at when not higher than price", () => {
    const out = canonicalPricingOptionsFromPayload([
      { id: "a", label: "X", price: 100, unit: "piece", compare_at_price: 100 },
    ]);
    expect(out![0].compare_at_price).toBeUndefined();
  });
});

describe("validateListingPricingJson", () => {
  it("accepts valid JSON with tiers ≥ ₹1", () => {
    const r = validateListingPricingJson(
      JSON.stringify([{ id: "x", label: "A", price: 50, unit: "piece" }])
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.options).toHaveLength(1);
  });

  it("rejects when every tier below ₹1", () => {
    const r = validateListingPricingJson(
      JSON.stringify([{ id: "x", label: "A", price: 0.5, unit: "piece" }])
    );
    expect(r.ok).toBe(false);
  });

  it("rejects empty tiers after canonicalization", () => {
    const r = validateListingPricingJson("[]");
    expect(r.ok).toBe(false);
  });

  it("rejects compare_at not higher than selling price", () => {
    const r = validateListingPricingJson(
      JSON.stringify([
        { id: "a", label: "X", price: 100, unit: "piece", compare_at_price: 100 },
      ])
    );
    expect(r.ok).toBe(false);
  });

  it("rejects tiers with different units (inventory must be one pool)", () => {
    const r = validateListingPricingJson(
      JSON.stringify([
        { id: "a", label: "A", price: 100, unit: "piece" },
        { id: "b", label: "B", price: 200, unit: "kg" },
      ])
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/same unit/i);
  });

  it("accepts multiple tiers when units match", () => {
    const r = validateListingPricingJson(
      JSON.stringify([
        { id: "a", label: "Large", price: 120, unit: "piece" },
        { id: "b", label: "Small", price: 80, unit: "piece" },
      ])
    );
    expect(r.ok).toBe(true);
  });
});

describe("pricingOptionsUniformUnit", () => {
  it("returns false when units differ", () => {
    expect(
      pricingOptionsUniformUnit([
        { id: "1", label: "A", price: 1, unit: "piece" },
        { id: "2", label: "B", price: 2, unit: "kg" },
      ])
    ).toBe(false);
  });
  it("returns true when all match", () => {
    expect(
      pricingOptionsUniformUnit([
        { id: "1", label: "A", price: 1, unit: "gram" },
        { id: "2", label: "B", price: 2, unit: "gram" },
      ])
    ).toBe(true);
  });
});

describe("deal display helpers", () => {
  it("optionHasDealDisplay when compare > price", () => {
    expect(
      optionHasDealDisplay({
        id: "1",
        label: "A",
        price: 80,
        unit: "piece",
        compare_at_price: 100,
      })
    ).toBe(true);
    expect(optionDiscountPercentDisplay({ id: "1", label: "A", price: 80, unit: "piece", compare_at_price: 100 })).toBe(
      20
    );
  });
});

describe("inventory helpers", () => {
  it("formatInventoryAmount rounds kg and floors count units", () => {
    expect(formatInventoryAmount(10.556, "kg")).toBe("10.56");
    expect(formatInventoryAmount(20.4, "piece")).toBe("20");
    expect(formatInventoryAmount(499.9, "gram")).toBe("499");
  });

  it("maxOrderQtyFromStock respects kg decimals", () => {
    expect(maxOrderQtyFromStock(10.55, "kg")).toBe(10.55);
    expect(maxOrderQtyFromStock(10.55, "piece")).toBe(10);
  });

  it("stockQuantityInputStep", () => {
    expect(stockQuantityInputStep("kg")).toBe("0.01");
    expect(stockQuantityInputStep("piece")).toBe("1");
  });
});

describe("getListingPriceOptions", () => {
  it("reads pricing_options only", () => {
    const opts = getListingPriceOptions({
      pricing_options: [{ id: "1", label: "Tier", price: 50, unit: "piece" }],
    });
    expect(opts[0].price).toBe(50);
  });

  it("returns empty when missing", () => {
    expect(getListingPriceOptions({ pricing_options: null }).length).toBe(0);
  });
});
