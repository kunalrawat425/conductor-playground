/**
 * Pay on delivery (founder, 6 Nov 2026). Never cash: after "Place order" the buyer may pay in the app
 * (Razorpay) when the fish arrives, instead of now. The order goes to the seller unpaid; it can be
 * confirmed and sent out, but only marked delivered once the payment is on it (DB check, migration 094).
 *
 * Pure rules, shared by the order page and the server, so both always agree.
 */

/** Pay on delivery is offered up to this cart total (fish + delivery), in rupees. */
export const POD_MAX_TOTAL = 1200;
/** One "buyer didn't pay" in this many days and pay on delivery is gone for that buyer. */
export const POD_REFUSAL_DAYS = 90;
/** cancel_reason the seller's "Buyer didn't pay" button writes (shown to the buyer as is). */
export const POD_REFUSED_REASON = "Not paid on delivery";
/** Unpaid (not pay-on-delivery) orders are cancelled this long after they were placed. */
export const UNPAID_EXPIRY_MS = 2 * 60 * 60 * 1000;

/** Statuses a pay-on-delivery order can still be paid in, after the seller accepted it. */
export const POD_PAYABLE_AFTER_ACCEPT = ["confirmed", "ready_for_pickup", "out_for_delivery"];
/** A pay-on-delivery order is "open" until it's delivered or closed. */
const DONE = ["completed", "picked_up", "cancelled", "declined", "refunded"];

export function isOpenPodOrder(o: { pay_on_delivery?: boolean | null; status: string }): boolean {
  return !!o.pay_on_delivery && !DONE.includes(o.status);
}

/** True while a pay-on-delivery row still waits for its money. */
export function podAwaitingPayment(o: { pay_on_delivery?: boolean | null; status: string; razorpay_payment_id?: string | null }): boolean {
  return !!o.pay_on_delivery && !o.razorpay_payment_id && !DONE.includes(o.status);
}

export type PodBlock =
  | { code: "seller_off"; message: string }
  | { code: "over_limit"; message: string }
  | { code: "open_order"; message: string; order_id: string }
  | { code: "refused_before"; message: string }
  | { code: "not_payable"; message: string };

export type PodCheck = {
  sellerAccepts: boolean;
  /** Cart total the buyer would pay (fish + delivery), rupees. */
  total: number;
  /** Rows of this checkout are still awaiting payment, unpaid and not already on pay on delivery. */
  payable: boolean;
  /** Another of the buyer's pay-on-delivery orders that isn't delivered yet (different checkout). */
  openOrderId?: string | null;
  /** The buyer's latest "didn't pay on delivery", ISO time, if any. */
  lastRefusedAt?: string | null;
  now?: number;
};

/** Why pay on delivery can't be offered, or null when it can. */
export function podBlockReason(c: PodCheck): PodBlock | null {
  if (!c.payable) return { code: "not_payable", message: "This order can't be switched to pay on delivery." };
  if (!c.sellerAccepts) return { code: "seller_off", message: "This seller doesn't take pay on delivery yet." };
  if (c.total > POD_MAX_TOTAL) return { code: "over_limit", message: `Pay on delivery is for orders up to ₹${POD_MAX_TOTAL.toLocaleString("en-IN")}.` };
  if (c.openOrderId) return { code: "open_order", order_id: c.openOrderId, message: "You already have a pay-on-delivery order. Pay or cancel it to use pay on delivery again." };
  if (c.lastRefusedAt && (c.now ?? Date.now()) - new Date(c.lastRefusedAt).getTime() < POD_REFUSAL_DAYS * 86400_000) {
    return { code: "refused_before", message: "Pay on delivery isn't available on your account right now. Please pay now." };
  }
  return null;
}
