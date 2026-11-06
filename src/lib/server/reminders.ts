/** Payment evidence on an order, shared by the messaging engine's unpaid reminder. */
export interface PendingOrderRow {
  razorpay_payment_id?: string | null;
  payment_verified_at?: string | null;
  payment_screenshot_urls?: string[] | null;
  pay_on_delivery?: boolean | null;
}

/** Any sign the buyer already paid (Razorpay capture, verified, or UPI proof uploaded awaiting check). */
export function hasPaymentEvidence(r: PendingOrderRow): boolean {
  // Pay on delivery: the buyer chose to pay at the door, so never send a "payment pending" nudge.
  if (r.pay_on_delivery) return true;
  return !!r.razorpay_payment_id || !!r.payment_verified_at || (Array.isArray(r.payment_screenshot_urls) && r.payment_screenshot_urls.length > 0);
}
