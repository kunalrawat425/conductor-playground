/**
 * Seller-level gates that apply to EVERY order, same-day or pre-order.
 *
 * BUG-46: the pre-order branch of /api/orders/create returns 201 before the
 * `if (seller_id)` block that ran these checks, so `min_order_amount`,
 * `has_delivery` and `has_pickup` were never enforced during the pre-order
 * window, and `delivery_fee` was hard-coded to 0.
 *
 * Verified against staging with has_delivery=false and min_order_amount=₹5000:
 * a delivery pre-order well under the minimum returned 201 with
 * order_type=delivery and delivery_fee=0. The identical request during
 * same-day hours returns 400.
 *
 * Shared so the two branches cannot drift apart again.
 */
export type SellerGateInput = {
  min_order_amount?: number | string | null;
  has_delivery?: boolean | null;
  has_pickup?: boolean | null;
};

/** Returns an error message when the seller cannot accept this order, else null. */
export function sellerRejectionReason(
  seller: SellerGateInput | null | undefined,
  opts: { order_type: string; total_price: number }
): string | null {
  if (!seller) return null;

  const minAmt = Number(seller.min_order_amount) || 0;
  if (minAmt > 0 && opts.total_price < minAmt) {
    return `Minimum order for this seller is ₹${minAmt}`;
  }
  if (opts.order_type === "delivery" && !seller.has_delivery) {
    return "This seller does not offer delivery";
  }
  if (opts.order_type === "pickup" && seller.has_pickup === false) {
    return "This seller does not offer pickup";
  }
  return null;
}
