import { describe, expect, it } from "vitest";
import { canonicalPricingOptionsFromPayload } from "../../src/lib/listing-pricing";

describe("MOST POPULAR ribbon survives a seller save", () => {
  it("keeps ribbon 'popular' and drops anything else", () => {
    const out = canonicalPricingOptionsFromPayload([
      { id: "a", label: "1 kg", price: 900, unit: "kg", bundle_size: 1, ribbon: "popular" },
      { id: "b", label: "500 g", price: 480, unit: "kg", bundle_size: 0.5, ribbon: "best" },
      { id: "c", label: "250 g", price: 250, unit: "kg", bundle_size: 0.25 },
    ])!;
    expect(out.map((o) => o.ribbon)).toEqual(["popular", undefined, undefined]);
  });
});
