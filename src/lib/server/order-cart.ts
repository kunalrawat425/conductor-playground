/**
 * A cart is one checkout. It still writes one order row per item (stock, seller
 * actions and refunds stay per item), but the rows share `orders.cart_id`
 * (migration 078) so the buyer pays ONE Razorpay order for the whole cart and
 * both parties get one notification. Rows without a cart_id behave as before.
 *
 * Shared payment rule: when one Razorpay payment covers several rows, a refund
 * for one row is a PARTIAL refund of that row's share, tagged with
 * notes.order_id so it can be found (and never repeated) per row.
 */

/** Statuses a cart row can be paid from in one go. Balance top-ups (payment_required) stay per row. */
export const CART_PAYABLE = ["pending", "pending_payment"];
const CLOSED = ["cancelled", "declined", "refunded"];

export type CartRow = {
  id: string;
  cart_id?: string | null;
  buyer_id?: string | null;
  status: string;
  total_price: number | string;
  delivery_fee?: number | string | null;
  razorpay_order_id?: string | null;
  razorpay_payment_id?: string | null;
  created_at?: string;
};

/** What a row costs upfront, in paise: item total plus the delivery fee it carries. */
export function rowPaise(r: Pick<CartRow, "total_price" | "delivery_fee">): number {
  return Math.round((Number(r.total_price) + Number(r.delivery_fee || 0)) * 100);
}

/**
 * Rows one Razorpay order should charge for, given the row the buyer pressed Pay on.
 * Same cart and buyer, still awaiting payment, and not tied to a different Razorpay
 * order (never overwrite an id that may have money against it — BUG-41).
 */
export function pickPayableCartRows<T extends CartRow>(order: T, siblings: T[]): T[] {
  if (!order.cart_id) return [order];
  const rows = siblings.filter((r) =>
    r.cart_id === order.cart_id &&
    r.buyer_id === order.buyer_id &&
    CART_PAYABLE.includes(r.status) &&
    !r.razorpay_payment_id &&
    (!r.razorpay_order_id || r.razorpay_order_id === order.razorpay_order_id)
  );
  if (!rows.some((r) => r.id === order.id)) rows.unshift(order);
  return rows.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

export async function loadPayableCartRows(sb: any, order: CartRow, cols: string): Promise<any[]> {
  if (!order.cart_id) return [order];
  const { data, error } = await sb.from("orders").select(cols).eq("cart_id", order.cart_id);
  if (error || !data?.length) return [order];
  return pickPayableCartRows(order, data);
}

/** Other rows paid by the same Razorpay payment (a cart paid in one go). */
export async function paymentSiblings(sb: any, paymentId: string, orderId: string): Promise<{ id: string }[]> {
  if (!paymentId) return [];
  const { data } = await sb.from("orders").select("id").eq("razorpay_payment_id", paymentId).neq("id", orderId);
  return data || [];
}

/** True while the row still counts as a live item (not closed). */
export function isLiveRow(status: string): boolean {
  return !CLOSED.includes(status);
}

function rzpAuth(): string | null {
  const keyId = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
  const keySecret = import.meta.env.RAZORPAY_KEY_SECRET || "";
  return keyId && keySecret ? `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` : null;
}

/**
 * Paise already refunded on a payment for ONE row (refunds carry notes.order_id).
 * null = Razorpay could not be asked; callers must not refund blind on null.
 */
export async function refundedPaiseForOrder(paymentId: string, orderId: string): Promise<number | null> {
  const auth = rzpAuth();
  if (!auth) return null;
  try {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refunds?count=100`, { headers: { Authorization: auth } });
    if (!res.ok) return null;
    const items: any[] = (await res.json())?.items ?? [];
    return items
      .filter((r) => r?.notes?.order_id === orderId && r?.status !== "failed")
      .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  } catch {
    return null;
  }
}

/** "Pomfret + Surmai" / "Pomfret + 2 more" — one label for a cart in pushes and subjects. */
export function cartLabel(species: (string | null | undefined)[]): string {
  const names = [...new Set(species.map((s) => String(s || "fish").trim()).filter(Boolean))]
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  if (names.length <= 2) return names.join(" + ") || "Fish";
  return `${names[0]} + ${names.length - 1} more`;
}
