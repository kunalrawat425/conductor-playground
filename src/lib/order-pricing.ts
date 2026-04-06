/** Delivery fee for one order line (subtotal = line items only). */
export function computeDeliveryFee(
  seller: {
    delivery_fee_enabled?: boolean | null;
    delivery_fee_amount?: number | string | null;
    free_delivery_above?: number | string | null;
  },
  subtotal: number,
  orderType: string
): number {
  if (orderType !== "delivery") return 0;
  if (!seller.delivery_fee_enabled) return 0;
  const thresh = seller.free_delivery_above;
  if (thresh != null && thresh !== "" && Number(thresh) > 0 && subtotal >= Number(thresh)) {
    return 0;
  }
  const fee = Number(seller.delivery_fee_amount) || 0;
  return Math.max(0, fee);
}
