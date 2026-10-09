/**
 * What a seller may see of an order. Buyer contact stays with Relifish: the
 * phone is reduced to its last 4 digits (enough to tell orders apart at the
 * counter), and the address is shown only for a delivery the seller has
 * accepted and must now fulfil.
 */
export const STATUS_BY_TAB: Record<string, string[]> = {
  // `paid` = buyer paid, seller hasn't accepted yet → needs action → New.
  pending: ["pending", "pending_payment", "pre_order", "scheduled", "paid"],
  accepted: ["confirmed", "payment_required", "ready_for_pickup", "out_for_delivery"],
  completed: ["picked_up", "completed", "declined", "cancelled", "refunded"],
};

const ADDRESS_STATUSES = ["confirmed", "ready_for_pickup", "out_for_delivery"];

export function toSellerView<T extends Record<string, any>>(o: T | null | undefined) {
  if (!o) return o;
  const { buyer_phone, buyer_addr, delivery_address, ...rest } = o;
  const showAddress = o.order_type === "delivery" && ADDRESS_STATUSES.includes(o.status);
  return {
    ...rest,
    buyer_phone: buyer_phone ? String(buyer_phone).replace(/\D/g, "").slice(-4) : null,
    buyer_addr: null,
    delivery_address: showAddress ? delivery_address ?? null : null,
  };
}
