/**
 * What a seller may see of an order. Buyer contact stays with Relifish: the
 * phone is reduced to its last 4 digits (enough to tell orders apart at the
 * counter), and the address is shown only for a delivery the seller has
 * accepted and must now fulfil. Before accepting, the seller sees only the area
 * and the distance (founder 24 Oct), so they can judge whether they deliver there.
 */
import { haversineKm } from "./order-pricing";
export const STATUS_BY_TAB: Record<string, string[]> = {
  // `paid` = buyer paid, seller hasn't accepted yet → needs action → New.
  pending: ["pending", "pending_payment", "pre_order", "scheduled", "paid"],
  accepted: ["confirmed", "payment_required", "ready_for_pickup", "out_for_delivery"],
  completed: ["picked_up", "completed", "declined", "cancelled", "refunded"],
};

const ADDRESS_STATUSES = ["confirmed", "ready_for_pickup", "out_for_delivery"];

export function toSellerView<T extends Record<string, any>>(o: T | null | undefined, seller?: { lat?: number | null; lng?: number | null } | null) {
  if (!o) return o;
  const { buyer_phone, buyer_addr, delivery_address, ...rest } = o;
  const isDelivery = o.order_type === "delivery";
  const showAddress = isDelivery && ADDRESS_STATUSES.includes(o.status);
  const a: any = delivery_address;
  const showArea = isDelivery && !showAddress && STATUS_BY_TAB.pending.includes(o.status) && a;
  const km = showArea && seller?.lat != null && seller?.lng != null && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng)) && (a.lat || a.lng)
    ? Math.round(haversineKm(Number(seller.lat), Number(seller.lng), Number(a.lat), Number(a.lng)) * 10) / 10 : null;
  return {
    ...rest,
    buyer_phone: buyer_phone ? String(buyer_phone).replace(/\D/g, "").slice(-4) : null,
    buyer_addr: null,
    delivery_address: showAddress ? delivery_address ?? null : null,
    delivery_area: showArea ? { name: a.location_name || null, km } : null,
  };
}
