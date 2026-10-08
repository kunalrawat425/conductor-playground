/**
 * Did money actually change hands for this order?
 *
 * BUG-42: `create_order_atomic` sets `paid_amount = total_price + delivery_fee`
 * at INSERT time, before any payment happens — it records what the buyer OWES,
 * not what they PAID. Readers that tested `paid_amount > 0` therefore treated
 * every unpaid order as paid. On a cancelled order that produced a phantom
 * refund obligation: the seller's dashboard said "Refund ₹1,800 to buyer via
 * UPI" for an order nobody ever paid for, and the buyer's track page said
 * "Refund pending".
 *
 * Evidence that money moved, any one of:
 *   - `razorpay_payment_id`  — a captured Razorpay payment
 *   - `payment_verified_at`  — seller or Razorpay verified the payment
 *   - a payment screenshot   — the buyer asserts they sent UPI money
 *
 * The screenshot counts deliberately. It is only a *claim*, but the buyer may
 * genuinely have transferred the money and the seller must be shown the refund
 * prompt so they can check the proof and decide. Erring toward showing the
 * seller a prompt they can dismiss is much safer than silently hiding a real
 * refund a buyer is owed. Staging has 2 such rows.
 *
 * Kept in one place so the dashboard and the track page cannot drift apart.
 */
export type PaymentEvidenceFields = {
  paid_amount?: number | string | null;
  payment_verified_at?: string | null;
  razorpay_payment_id?: string | null;
  payment_screenshot_urls?: unknown;
};

export function wasActuallyPaid(order: PaymentEvidenceFields): boolean {
  const paid = Number(order?.paid_amount) || 0;
  if (paid <= 0) return false;
  const hasScreenshot = Array.isArray(order?.payment_screenshot_urls)
    && order.payment_screenshot_urls.length > 0;
  return !!(order?.razorpay_payment_id || order?.payment_verified_at || hasScreenshot);
}

/** Amount genuinely owed back to the buyer, or 0 when nothing was ever paid. */
export function refundableAmount(order: PaymentEvidenceFields): number {
  return wasActuallyPaid(order) ? Number(order.paid_amount) || 0 : 0;
}

export type PaymentLabelFields = PaymentEvidenceFields & { payment_method?: string | null };

/**
 * How this order was paid, in one place for the buyer and seller screens.
 *
 * The track page used to say "Paid via UPI" whenever `paid_amount > 0` — which
 * create_order_atomic sets at INSERT (see wasActuallyPaid), so every unpaid
 * order read as paid. `payment_type` in the DB is no help either: it was
 * hardcoded to 'cod' for years (now derived by migration 069).
 * Returns null when there is no evidence of payment; callers pick their own
 * "pending" wording.
 */
export function paymentMethodLabel(o: PaymentLabelFields): string | null {
  if (o?.payment_method === "razorpay" && o.razorpay_payment_id) return "Paid online · Razorpay";
  if (o?.payment_method === "cod_legacy") return "Cash on delivery (legacy order)";
  if (o?.payment_verified_at) return "Paid via UPI · verified by seller";
  const hasScreenshot = Array.isArray(o?.payment_screenshot_urls) && o.payment_screenshot_urls.length > 0;
  if (hasScreenshot) return "UPI proof submitted — seller will verify";
  return null;
}
