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
 * null = unsafe to refund automatically: Razorpay could not be asked, or someone
 * refunded by hand from the dashboard (no tag), so we can't tell whose money it was.
 * `remaining` caps any new refund at what is still on the payment.
 */
export async function refundStateForOrder(paymentId: string, orderId: string): Promise<{ forOrder: number; remaining: number } | null> {
  const auth = rzpAuth();
  if (!auth) return null;
  try {
    const [rRes, pRes] = await Promise.all([
      fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refunds?count=100`, { headers: { Authorization: auth } }),
      fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, { headers: { Authorization: auth } }),
    ]);
    if (!rRes.ok || !pRes.ok) return null;
    const items: any[] = ((await rRes.json())?.items ?? []).filter((r: any) => r?.status !== "failed");
    if (items.some((r) => !r?.notes?.order_id)) return null;
    const pay = await pRes.json();
    return {
      forOrder: items.filter((r) => r.notes.order_id === orderId).reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
      remaining: Math.max(0, (Number(pay?.amount) || 0) - (Number(pay?.amount_refunded) || 0)),
    };
  } catch {
    return null;
  }
}

/** Paise refunded for one row on a payment, or null when unsafe to tell (see refundStateForOrder). */
export async function refundedPaiseForOrder(paymentId: string, orderId: string): Promise<number | null> {
  return (await refundStateForOrder(paymentId, orderId))?.forOrder ?? null;
}

/** "Pomfret + Surmai" / "Pomfret + 2 more" — one label for a cart in pushes and subjects. */
export function cartLabel(species: (string | null | undefined)[]): string {
  const names = [...new Set(species.map((s) => String(s || "fish").trim()).filter(Boolean))]
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  if (names.length <= 2) return names.join(" + ") || "Fish";
  return `${names[0]} + ${names.length - 1} more`;
}

/**
 * An UNPAID item that carries the cart's delivery fee was just closed: move the fee
 * to the oldest item still awaiting payment, so the cart is still charged for
 * delivery (removing a cheap first item used to make delivery free).
 */
export async function moveFeeOffClosedRow(sb: any, orderId: string): Promise<void> {
  const { data: row } = await sb.from("orders")
    .select("id, cart_id, delivery_fee, paid_amount, razorpay_payment_id").eq("id", orderId).maybeSingle();
  const fee = Number(row?.delivery_fee || 0);
  if (!row?.cart_id || fee <= 0 || row.razorpay_payment_id) return;
  const { data: siblings } = await sb.from("orders")
    .select("id, status, delivery_fee, paid_amount, created_at")
    .eq("cart_id", row.cart_id).neq("id", orderId).in("status", CART_PAYABLE).is("razorpay_payment_id", null)
    .order("created_at", { ascending: true });
  const to = siblings?.[0];
  if (!to) return;
  // Guarded on the fee still being on the closed row, so a repeat moves nothing.
  const { data: moved } = await sb.from("orders")
    .update({ delivery_fee: 0, ...(row.paid_amount != null ? { paid_amount: Number(row.paid_amount) - fee } : {}) })
    .eq("id", orderId).eq("delivery_fee", row.delivery_fee).select("id");
  if (!moved?.length) return;
  const { error } = await sb.from("orders").update({
    delivery_fee: Number(to.delivery_fee || 0) + fee,
    ...(to.paid_amount != null ? { paid_amount: Number(to.paid_amount) + fee } : {}),
  }).eq("id", to.id);
  if (error) console.error("[order-cart] delivery fee move failed", { from: orderId, to: to.id, fee, err: error.message });
}
