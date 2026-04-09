import { describe, it, expect } from "vitest";
import { validateSellerListingForm } from "../../src/lib/listing-form-validation";

const validPricing = JSON.stringify([
  { id: "a", label: "Per piece", price: 100, unit: "piece" },
]);

describe("validateSellerListingForm", () => {
  it("rejects empty species", () => {
    const r = validateSellerListingForm({
      species: "",
      weightAvailStr: "10",
      pricingOptionsJson: validPricing,
      buyerDailyStr: "",
      oosThresholdStr: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.focusId).toBe("species");
  });

  it("accepts minimal valid payload", () => {
    const r = validateSellerListingForm({
      species: "pomfret",
      weightAvailStr: "10",
      pricingOptionsJson: validPricing,
      buyerDailyStr: "",
      oosThresholdStr: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.weightAvail).toBe(10);
      expect(r.data.buyerDaily).toBeNull();
    }
  });

  it("rejects fractional stock for piece", () => {
    const r = validateSellerListingForm({
      species: "pomfret",
      weightAvailStr: "10.5",
      pricingOptionsJson: validPricing,
      buyerDailyStr: "",
      oosThresholdStr: "",
    });
    expect(r.ok).toBe(false);
  });

  it("allows decimal stock for kg", () => {
    const r = validateSellerListingForm({
      species: "pomfret",
      weightAvailStr: "3.25",
      pricingOptionsJson: JSON.stringify([
        { id: "a", label: "Per kg", price: 400, unit: "kg" },
      ]),
      buyerDailyStr: "",
      oosThresholdStr: "",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.weightAvail).toBe(3.25);
  });

  it("rejects oos threshold above stock", () => {
    const r = validateSellerListingForm({
      species: "pomfret",
      weightAvailStr: "5",
      pricingOptionsJson: validPricing,
      buyerDailyStr: "",
      oosThresholdStr: "10",
    });
    expect(r.ok).toBe(false);
  });
});
