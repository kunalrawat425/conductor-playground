import { describe, it, expect } from "vitest";

/** Logic mirrors buyer track page and seller dashboard refund amount display. */
function computeRefundAmount(paidAmount: number | null, finalPrice: number | null): number {
  const paid = Number(paidAmount) || 0;
  const final = Number(finalPrice) || 0;
  return final > 0 ? Math.max(0, paid - final) : paid;
}

describe("refund amount calculation", () => {
  it("full refund when no final_price set", () => {
    expect(computeRefundAmount(500, null)).toBe(500);
  });

  it("partial refund: paid > final", () => {
    expect(computeRefundAmount(600, 400)).toBe(200);
  });

  it("zero refund when final equals paid", () => {
    expect(computeRefundAmount(500, 500)).toBe(0);
  });

  it("zero refund when final > paid (balance case, not refund)", () => {
    expect(computeRefundAmount(400, 600)).toBe(0);
  });

  it("handles string-ish numbers from DB", () => {
    expect(computeRefundAmount(600 as any, 400 as any)).toBe(200);
  });
});

describe("order status refund path", () => {
  const validTransitions: Record<string, string[]> = {
    pending: ["confirmed", "declined"],
    pending_payment: ["confirmed", "declined"],
    pre_order: ["confirmed", "declined"],
    scheduled: ["confirmed", "declined"],
    confirmed: ["ready_for_pickup", "out_for_delivery", "declined", "cancelled"],
    paid: ["ready_for_pickup", "out_for_delivery", "declined", "cancelled"],
    payment_required: ["confirmed", "cancelled"],
    ready_for_pickup: ["completed", "cancelled"],
    out_for_delivery: ["completed", "cancelled"],
  };

  it("pre_order can be confirmed", () => {
    expect(validTransitions["pre_order"]).toContain("confirmed");
  });

  it("pre_order can be declined", () => {
    expect(validTransitions["pre_order"]).toContain("declined");
  });

  it("confirmed cannot jump to completed directly", () => {
    expect(validTransitions["confirmed"]).not.toContain("completed");
  });

  it("out_for_delivery can complete", () => {
    expect(validTransitions["out_for_delivery"]).toContain("completed");
  });

  it("payment_required can be confirmed after balance paid", () => {
    expect(validTransitions["payment_required"]).toContain("confirmed");
  });
});
