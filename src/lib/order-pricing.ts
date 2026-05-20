/** Haversine distance in km between two lat/lng points. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Delivery fee for one order line (subtotal = line items only). */
export function computeDeliveryFee(
  seller: {
    delivery_fee_enabled?: boolean | null;
    delivery_fee_amount?: number | string | null;
    delivery_fee_type?: string | null;
    delivery_fee_per_km?: number | string | null;
    free_delivery_above?: number | string | null;
  },
  subtotal: number,
  orderType: string,
  distanceKm?: number
): number {
  if (orderType !== "delivery") return 0;
  if (!seller.delivery_fee_enabled) return 0;
  const thresh = seller.free_delivery_above;
  if (thresh != null && thresh !== "" && Number(thresh) > 0 && subtotal >= Number(thresh)) {
    return 0;
  }
  const feeType = seller.delivery_fee_type || "fixed";
  if (feeType === "per_km" && distanceKm != null && distanceKm >= 0) {
    const perKm = Number(seller.delivery_fee_per_km) || 0;
    return Math.max(0, Math.ceil(distanceKm * perKm));
  }
  return Math.max(0, Number(seller.delivery_fee_amount) || 0);
}
