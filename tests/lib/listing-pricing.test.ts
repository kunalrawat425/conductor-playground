import { describe, it, expect } from "vitest";
import {
  canonicalPricingOptionsFromPayload,
  validateListingPricingJson,
  getListingPriceOptions,
  optionHasDealDisplay,
  optionDiscountPercentDisplay,
  formatInventoryAmount,
  maxOrderQtyFromStock,
  maxBundlesFromStock,
  optionBundleSize,
  optionBundleAmount,
  isPerBaseUnitPricing,
  minimumRequiredBuyerDailyCap,
  stockQuantityInputStep,
  pricingOptionsUniformUnit,
  formatBundleSizeLead,
  formatPriceOptionDropdownLabel,
  formatBuyerMenuUnitSuffix,
} from "../../src/lib/listing-pricing";

describe("canonicalPricingOptionsFromPayload", () => {
  it("maps legacy dozen to piece", () => {
    expect(
      canonicalPricingOptionsFromPayload([{ id: "k", label: "Per dozen", price: 300, unit: "dozen" }])![0].unit
    ).toBe("piece");
  });

  it("normalizes kg and legacy g/gram to kg", () => {
    expect(
      canonicalPricingOptionsFromPayload([{ id: "k", label: "A", price: 400, unit: "kg" }])![0].unit
    ).toBe("kg");
    const legacy = canonicalPricingOptionsFromPayload([
      { id: "g", label: "B", price: 200, unit: "g", bundle_size: 500 },
    ])![0];
    expect(legacy.unit).toBe("kg");
    expect(legacy.bundle_size).toBe(0.5);
  });

  it("parses valid tiers and drops invalid rows", () => {
    const out = canonicalPricingOptionsFromPayload([
      { id: "a", label: "Large", price: 100, unit: "piece" },
      { id: "b", label: "Bad", price: 0, unit: "piece" },
    ]);
    expect(out).toHaveLength(1);
    expect(out![0].id).toBe("a");
    expect(out![0].price).toBe(100);
    expect(out![0].bundle_size).toBe(1);
  });

  it("returns null for empty or invalid", () => {
    expect(canonicalPricingOptionsFromPayload(null)).toBeNull();
    expect(canonicalPricingOptionsFromPayload([])).toBeNull();
    expect(canonicalPricingOptionsFromPayload([{ price: 0 }])).toBeNull();
  });

  it("parses bundle_size for piece tiers", () => {
    const out = canonicalPricingOptionsFromPayload([
      { id: "a", label: "3-pack", price: 300, unit: "piece", bundle_size: 3 },
    ]);
    expect(out![0].bundle_size).toBe(3);
    expect(optionBundleSize(out![0])).toBe(3);
  });

  it("stores kg bundle_size (defaults to 1)", () => {
    const out = canonicalPricingOptionsFromPayload([{ id: "a", label: "A", price: 400, unit: "kg" }]);
    expect(out![0].bundle_size).toBe(1);
    expect(isPerBaseUnitPricing(out![0])).toBe(true);
  });

  it("kg half-kg pack is not per-base pricing", () => {
    const o = { id: "a", label: "Half", price: 200, unit: "kg" as const, bundle_size: 0.5 };
    expect(isPerBaseUnitPricing(o)).toBe(false);
    expect(optionBundleAmount(o)).toBe(0.5);
  });

  it("legacy per-gram (1 g) becomes kg clamped to minimum 0.01 kg", () => {
    const out = canonicalPricingOptionsFromPayload([{ id: "g", label: "G", price: 2, unit: "g" }]);
    expect(out![0].unit).toBe("kg");
    expect(out![0].bundle_size).toBe(0.01);
  });

  it("minimumRequiredBuyerDailyCap uses smallest pack and seller min ₹", () => {
    const opts = canonicalPricingOptionsFromPayload([
      { id: "a", label: "3pc", price: 100, unit: "piece", bundle_size: 3 },
      { id: "b", label: "1pc", price: 50, unit: "piece", bundle_size: 1 },
    ])!;
    expect(minimumRequiredBuyerDailyCap(opts, 0)).toBe(3);
    expect(minimumRequiredBuyerDailyCap(opts, 100)).toBe(3);
    expect(minimumRequiredBuyerDailyCap(opts, 200)).toBe(4);
  });

  it("maxBundlesFromStock counts full packs only", () => {
    expect(maxBundlesFromStock(10, "piece", 3)).toBe(3);
    expect(maxBundlesFromStock(2, "piece", 3)).toBe(0);
  });

  it("defaults piece bundle_size to 1 when omitted", () => {
    const out = canonicalPricingOptionsFromPayload([{ id: "a", label: "A", price: 50, unit: "piece" }]);
    expect(out![0].bundle_size).toBe(1);
    expect(optionBundleSize(out![0])).toBe(1);
  });

  it("stores compare_at_price when higher than selling price", () => {
    const out = canonicalPricingOptionsFromPayload([
      { id: "a", label: "Deal", price: 80, unit: "piece", compare_at_price: 100 },
    ]);
    expect(out![0].compare_at_price).toBe(100);
    expect(out![0].bundle_size).toBe(1);
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

  it("accepts multiple piece tiers with different bundle_size (multi-pack)", () => {
    const r = validateListingPricingJson(
      JSON.stringify([
        { id: "a", label: "Single", price: 50, unit: "piece", bundle_size: 1 },
        { id: "b", label: "6-pack", price: 280, unit: "piece", bundle_size: 6 },
      ])
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.options[0].bundle_size).toBe(1);
      expect(r.options[1].bundle_size).toBe(6);
    }
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
        { id: "1", label: "A", price: 1, unit: "kg" },
        { id: "2", label: "B", price: 2, unit: "kg" },
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

describe("menu bundle labels", () => {
  it("formatBundleSizeLead matches pack vs per-base", () => {
    expect(formatBundleSizeLead({ id: "a", label: "x", price: 1, unit: "piece", bundle_size: 3 })).toBe("3 pieces");
    expect(formatBundleSizeLead({ id: "a", label: "x", price: 1, unit: "piece", bundle_size: 1 })).toBe("Per piece");
    expect(formatBundleSizeLead({ id: "a", label: "x", price: 1, unit: "kg", bundle_size: 0.5 })).toBe("0.5 kg");
  });

  it("formatPriceOptionDropdownLabel includes lead and label", () => {
    const s = formatPriceOptionDropdownLabel({
      id: "a",
      label: "Large",
      price: 150,
      unit: "piece",
      bundle_size: 3,
    });
    expect(s).toContain("3 pieces");
    expect(s).toContain("₹150");
    expect(s).toContain("Large");
  });
});

describe("formatBuyerMenuUnitSuffix", () => {
  it("piece per-base → /pc", () => {
    expect(formatBuyerMenuUnitSuffix({ id: "a", label: "A", price: 10, unit: "piece", bundle_size: 1 })).toBe("/pc");
  });
  it("piece pack → /3pc", () => {
    expect(formatBuyerMenuUnitSuffix({ id: "a", label: "A", price: 300, unit: "piece", bundle_size: 3 })).toBe("/3pc");
  });
  it("kg per-base → /kg", () => {
    expect(formatBuyerMenuUnitSuffix({ id: "a", label: "A", price: 400, unit: "kg", bundle_size: 1 })).toBe("/kg");
  });
  it("kg fixed weight → /nkg", () => {
    expect(formatBuyerMenuUnitSuffix({ id: "a", label: "A", price: 200, unit: "kg", bundle_size: 0.5 })).toBe("/0.5kg");
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
