import { describe, it, expect } from "vitest";
import { computeDeliveryFee } from "../../src/lib/order-pricing";

describe("order-pricing", () => {
  it("no fee for pickup", () => {
    expect(
      computeDeliveryFee({ delivery_fee_enabled: true, delivery_fee_amount: 40 }, 500, "pickup")
    ).toBe(0);
  });

  it("fee when enabled for delivery", () => {
    expect(
      computeDeliveryFee({ delivery_fee_enabled: true, delivery_fee_amount: 40 }, 500, "delivery")
    ).toBe(40);
  });

  it("waives fee above threshold", () => {
    expect(
      computeDeliveryFee(
        { delivery_fee_enabled: true, delivery_fee_amount: 40, free_delivery_above: 600 },
        600,
        "delivery"
      )
    ).toBe(0);
  });

  it("disabled means no fee", () => {
    expect(
      computeDeliveryFee({ delivery_fee_enabled: false, delivery_fee_amount: 40 }, 500, "delivery")
    ).toBe(0);
  });
});
