import { describe, expect, it } from "vitest";
import {
  getBuyerStepperVariant,
  isPartialAdvanceCatch,
  isPreorderCatchFlow,
  resolveBuyerStepper,
  usesSameDayPaymentStepper,
} from "../../src/lib/buyer-order-stepper";

describe("isPartialAdvanceCatch", () => {
  it("is false when full amount due matches paid on pending_payment", () => {
    expect(
      isPartialAdvanceCatch({
        status: "pending_payment",
        paid_amount: 500,
        total_price: 400,
        delivery_fee: 100,
      })
    ).toBe(false);
  });

  it("is true when paid is less than total + delivery", () => {
    expect(
      isPartialAdvanceCatch({
        status: "pending_payment",
        paid_amount: 100,
        total_price: 500,
        delivery_fee: 0,
      })
    ).toBe(true);
  });
});

describe("isPreorderCatchFlow", () => {
  it("returns false for same-day paid order (paid_amount + final_price match total)", () => {
    expect(
      isPreorderCatchFlow({
        status: "confirmed",
        paid_amount: 500,
        final_price: 500,
        total_price: 500,
      })
    ).toBe(false);
  });

  it("returns true for explicit pre_order", () => {
    expect(isPreorderCatchFlow({ status: "pre_order" })).toBe(true);
  });

  it("returns true for payment_required", () => {
    expect(isPreorderCatchFlow({ status: "payment_required" })).toBe(true);
  });

  it("returns true for pending_payment with partial advance", () => {
    expect(
      isPreorderCatchFlow({
        status: "pending_payment",
        paid_amount: 100,
        total_price: 500,
        delivery_fee: 0,
      })
    ).toBe(true);
  });

  it("returns false for pending_payment with full pay (pay-first same-day)", () => {
    expect(
      isPreorderCatchFlow({
        status: "pending_payment",
        paid_amount: 500,
        total_price: 400,
        delivery_fee: 100,
      })
    ).toBe(false);
  });

  it("returns true when final reconciles from total (post-pay)", () => {
    expect(
      isPreorderCatchFlow({
        status: "confirmed",
        paid_amount: 200,
        final_price: 450,
        total_price: 500,
      })
    ).toBe(true);
  });

  it("returns true for scheduled pickup on pre-order-enabled listing", () => {
    expect(
      isPreorderCatchFlow({
        status: "scheduled",
        listing: { is_preorder_enabled: true },
      })
    ).toBe(true);
  });
});

describe("usesSameDayPaymentStepper", () => {
  it("is true for pending_payment full pay (pay-first)", () => {
    expect(
      usesSameDayPaymentStepper({
        status: "pending_payment",
        paid_amount: 500,
        total_price: 400,
        delivery_fee: 100,
      })
    ).toBe(true);
  });

  it("is false when catch preorder (partial advance)", () => {
    expect(
      usesSameDayPaymentStepper({
        status: "pending_payment",
        paid_amount: 100,
        total_price: 500,
        delivery_fee: 0,
      })
    ).toBe(false);
  });

  it("is true when proof on file even if confirmed", () => {
    expect(
      usesSameDayPaymentStepper({
        status: "confirmed",
        payment_screenshot_urls: ["a/b.png"],
      })
    ).toBe(true);
  });

  it("is false for cancelled", () => {
    expect(usesSameDayPaymentStepper({ status: "cancelled" })).toBe(false);
  });
});

describe("resolveBuyerStepper", () => {
  it("uses 5-step payment path for same-day pending_payment (full pay)", () => {
    const r = resolveBuyerStepper(
      { status: "pending_payment", paid_amount: 400, total_price: 400, delivery_fee: 0 },
      "pickup"
    );
    expect(r.variant).toBe("payment");
    expect(r.labels).toEqual(["Placed", "Payment proof", "Confirmed", "Ready", "Picked up"]);
    expect(r.step).toBe(0);
  });

  it("uses preorder variant when partial advance on pending_payment", () => {
    const r = resolveBuyerStepper(
      { status: "pending_payment", paid_amount: 100, total_price: 500, delivery_fee: 0 },
      "pickup"
    );
    expect(r.variant).toBe("preorder");
    expect(r.labels[2]).toBe("Price set");
  });

  it("uses payment 5-step for confirmed without screenshots (pay-first messaging)", () => {
    const r = resolveBuyerStepper({ status: "confirmed" }, "pickup");
    expect(r.variant).toBe("payment");
    expect(r.labels.length).toBe(5);
    expect(r.step).toBe(2);
  });

  it("getBuyerStepperVariant payment when payment_verified_at set", () => {
    expect(
      getBuyerStepperVariant({
        status: "confirmed",
        payment_verified_at: "2026-01-01T00:00:00Z",
      })
    ).toBe("payment");
  });

  it("uses payment variant when confirmed after UPI (paid_amount, no screenshots)", () => {
    expect(
      getBuyerStepperVariant({
        status: "confirmed",
        paid_amount: 450,
        total_price: 450,
        payment_screenshot_urls: [],
      })
    ).toBe("payment");
    const r = resolveBuyerStepper(
      {
        status: "confirmed",
        paid_amount: 450,
        total_price: 450,
      },
      "pickup"
    );
    expect(r.labels[1]).toBe("Payment proof");
    expect(r.step).toBe(2);
  });

  it("payment track advances Payment proof dot after upload on scheduled", () => {
    const before = resolveBuyerStepper(
      { status: "scheduled", paid_amount: 100, total_price: 100, payment_screenshot_urls: [] },
      "pickup"
    );
    expect(before.variant).toBe("payment");
    expect(before.step).toBe(0);
    const after = resolveBuyerStepper(
      { status: "scheduled", paid_amount: 100, total_price: 100, payment_screenshot_urls: ["x/y.png"] },
      "pickup"
    );
    expect(after.step).toBe(1);
  });

  it("preorder track advances proof step for scheduled + preorder listing", () => {
    const o = {
      status: "scheduled" as const,
      listing: { is_preorder_enabled: true },
      payment_screenshot_urls: [] as string[],
    };
    const r0 = resolveBuyerStepper(o, "pickup");
    expect(r0.variant).toBe("preorder");
    expect(r0.step).toBe(0);
    const r1 = resolveBuyerStepper({ ...o, payment_screenshot_urls: ["a/b.png"] }, "pickup");
    expect(r1.step).toBe(1);
  });
});
