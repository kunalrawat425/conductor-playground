/**
 * Buyer order stepper: same language for “seller must approve UPI proof” on both
 * same-day and catch pre-orders. Catch pre-orders add a **Price set** step after payment.
 *
 * - `simple` — 4 steps: no UPI proof track on this order (COD / never uploaded / no verify path).
 * - `payment` — 5 steps: Placed → Payment proof → Confirmed → Ready / On the way → …
 * - `preorder` — 5 steps: Pre-ordered → Payment proof → Price set → Confirmed → …
 */

export type BuyerStepperVariant = "simple" | "payment" | "preorder";

export type BuyerStepperOrder = {
  status: string;
  paid_amount?: unknown;
  final_price?: unknown;
  total_price?: unknown;
  delivery_fee?: unknown;
  payment_screenshot_urls?: unknown;
  payment_verified_at?: unknown;
  /** Joined listing (track list / detail) — used to show payment stepper for scheduled pre-order pickups. */
  listing?: { is_preorder_enabled?: boolean | null } | null;
};

/** Amount buyer was asked to pay up front (line + delivery). */
export function orderAmountDue(o: Pick<BuyerStepperOrder, "total_price" | "delivery_fee">): number {
  const total = Number(o.total_price) || 0;
  const del = Number(o.delivery_fee) || 0;
  return total + del;
}

/** Next-day / catch pre-order: partial advance (paid < due) or explicit pre_order statuses. */
export function isPartialAdvanceCatch(o: BuyerStepperOrder): boolean {
  if (o.status === "pre_order" || o.status === "payment_required") return true;
  const paid = Number(o.paid_amount);
  const due = orderAmountDue(o);
  if (o.status === "pending_payment" && Number.isFinite(paid) && paid > 0 && Number.isFinite(due) && due > 0 && paid + 0.01 < due) {
    return true;
  }
  return false;
}

function listingPreorderEnabled(o: BuyerStepperOrder): boolean {
  return o.listing?.is_preorder_enabled === true;
}

/**
 * Next-day catch / OOS pre-order (includes morning **Price set** reconciliation).
 */
export function isPreorderCatchFlow(o: BuyerStepperOrder): boolean {
  const st = o.status;
  if (st === "pre_order") return true;
  if (st === "payment_required") return true;
  if (isPartialAdvanceCatch(o)) return true;
  const paid = Number(o.paid_amount);
  const finRaw = o.final_price;
  const fin = finRaw != null && finRaw !== "" ? Number(finRaw) : NaN;
  const total = Number(o.total_price) || 0;
  const postPay = [
    "confirmed",
    "paid",
    "ready_for_pickup",
    "out_for_delivery",
    "picked_up",
    "completed",
  ].includes(st);
  if (
    postPay &&
    Number.isFinite(fin) &&
    Number.isFinite(paid) &&
    paid > 0 &&
    Math.abs(total - fin) > 0.01
  ) {
    return true;
  }
  if (st === "scheduled" && listingPreorderEnabled(o)) return true;
  return false;
}

/** Pay-first: always show Payment proof → Confirmed unless this is catch pre-order flow or terminal. */
export function usesSameDayPaymentStepper(o: BuyerStepperOrder): boolean {
  if (isPreorderCatchFlow(o)) return false;
  const st = o.status;
  if (["declined", "cancelled", "refunded"].includes(st)) return false;
  return true;
}

export function getBuyerStepperVariant(o: BuyerStepperOrder): BuyerStepperVariant {
  if (["declined", "cancelled", "refunded"].includes(o.status)) return "simple";
  if (isPreorderCatchFlow(o)) return "preorder";
  return "payment";
}

export function getBuyerStepperLabels(
  variant: BuyerStepperVariant,
  orderType: "pickup" | "delivery"
): string[] {
  const last = orderType === "delivery" ? "Delivered" : "Picked up";
  if (variant === "simple") {
    return orderType === "delivery"
      ? ["Placed", "Confirmed", "On the way", "Delivered"]
      : ["Placed", "Confirmed", "Ready", last];
  }
  if (variant === "payment") {
    return orderType === "delivery"
      ? ["Placed", "Payment proof", "Confirmed", "On the way", last]
      : ["Placed", "Payment proof", "Confirmed", "Ready", last];
  }
  return ["Pre-ordered", "Payment proof", "Price set", "Confirmed", last];
}

function simpleStatusStep(status: string, orderType: "pickup" | "delivery"): number {
  if (orderType === "delivery") {
    const m: Record<string, number> = {
      pending: 0,
      pending_payment: 0,
      pre_order: 0,
      scheduled: 0,
      confirmed: 1,
      paid: 1,
      payment_required: 1,
      out_for_delivery: 2,
      picked_up: 3,
      completed: 3,
      refunded: 3,
    };
    return m[status] ?? 0;
  }
  const m: Record<string, number> = {
    pending: 0,
    pending_payment: 0,
    pre_order: 0,
    scheduled: 0,
    confirmed: 1,
    paid: 1,
    payment_required: 1,
    ready_for_pickup: 2,
    picked_up: 3,
    completed: 3,
    refunded: 3,
  };
  return m[status] ?? 0;
}

function paymentTrackStep(
  status: string,
  hasPaymentProof: boolean,
  _orderType: "pickup" | "delivery"
): number {
  const m: Record<string, number> = {
    pre_order: 0,
    pending: 0,
    scheduled: hasPaymentProof ? 1 : 0,
    pending_payment: hasPaymentProof ? 1 : 0,
    payment_required: 1,
    confirmed: 2,
    paid: 2,
    ready_for_pickup: 3,
    out_for_delivery: 3,
    picked_up: 4,
    completed: 4,
    refunded: 4,
    cancelled: 0,
    declined: 0,
  };
  return m[status] ?? 0;
}

function preorderTrackStep(status: string, hasPaymentProof: boolean): number {
  const m: Record<string, number> = {
    pre_order: 0,
    pending: 0,
    scheduled: hasPaymentProof ? 1 : 0,
    pending_payment: hasPaymentProof ? 1 : 0,
    payment_required: 2,
    confirmed: 3,
    paid: 3,
    ready_for_pickup: 4,
    out_for_delivery: 4,
    picked_up: 4,
    completed: 4,
    refunded: 4,
    cancelled: 0,
    declined: 0,
  };
  return m[status] ?? 0;
}

export function getBuyerStepperStep(o: BuyerStepperOrder, orderType: "pickup" | "delivery"): number {
  const variant = getBuyerStepperVariant(o);
  const hasPaymentProof =
    Array.isArray(o.payment_screenshot_urls) && o.payment_screenshot_urls.length > 0;
  if (variant === "simple") return simpleStatusStep(o.status, orderType);
  if (variant === "payment") return paymentTrackStep(o.status, hasPaymentProof, orderType);
  return preorderTrackStep(o.status, hasPaymentProof);
}

export function resolveBuyerStepper(
  o: BuyerStepperOrder,
  orderType: "pickup" | "delivery"
): { variant: BuyerStepperVariant; labels: string[]; step: number } {
  const variant = getBuyerStepperVariant(o);
  return {
    variant,
    labels: getBuyerStepperLabels(variant, orderType),
    step: getBuyerStepperStep(o, orderType),
  };
}
