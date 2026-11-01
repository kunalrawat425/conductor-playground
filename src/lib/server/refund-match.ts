/**
 * A manual dashboard refund on a shared (cart) payment carries no item id. Attribute it only when
 * exactly one cancelled/declined, not-yet-refunded item on that payment matches the amount
 * (item price, or price + its delivery fee). Pure; tested.
 */
export function matchManualRefund<T extends { status: string; refund_sent_at?: string | null; total_price?: any; delivery_fee?: any }>(rows: T[], paise: number): T | null {
  const hits = rows.filter((r) => ["cancelled", "declined"].includes(r.status) && !r.refund_sent_at)
    .filter((r) => {
      const price = Math.round(Number(r.total_price || 0) * 100), fee = Math.round(Number(r.delivery_fee || 0) * 100);
      return paise === price || paise === price + fee;
    });
  return hits.length === 1 ? hits[0] : null;
}
