/**
 * Relifish Partner (seller app): the website's seller dashboard rules (src/pages/dashboard/orders/index.astro)
 * as data, so the screens only draw them. Every write goes through the same /api/seller/* routes, which
 * re-check each transition server-side; this file only decides which buttons to show.
 */
import { api, getSession } from "./api";
import { preorderNeedsFinalPrice } from "../../src/lib/order-payment-state";

export const CLOSED = ["completed", "picked_up", "declined", "cancelled", "refunded"];

export const BADGE: Record<string, [string, "blue" | "purple" | "amber" | "green" | "red" | "grey"]> = {
  pending: ["New", "blue"], pre_order: ["Pre-order", "purple"], pending_payment: ["New", "blue"], scheduled: ["Scheduled", "blue"],
  confirmed: ["Confirmed", "blue"], paid: ["Paid, confirm", "amber"], ready_for_pickup: ["Ready", "green"], out_for_delivery: ["Out for delivery", "green"],
  picked_up: ["Picked up", "grey"], completed: ["Completed", "grey"], payment_required: ["Extra payment needed", "amber"],
  declined: ["Declined", "red"], cancelled: ["Cancelled", "red"], refunded: ["Refunded", "red"],
};

/** Dashboard action → order status the API moves to (statusMap in the dashboard). */
export const STATUS_FOR: Record<string, string> = {
  accept: "confirmed", decline: "declined", ready: "ready_for_pickup", out_for_delivery: "out_for_delivery",
  picked_up: "completed", delivered: "completed", seller_cancel: "cancelled", pod_refused: "cancelled",
};
export type Act = { action: string; label: string; kind: "primary" | "danger" | "secondary" | "success"; disabled?: boolean };
/** row: the first two buttons sit side by side (the dashboard's Confirm / Can't fulfill pair). */
export type Plan = { note?: { text: string; tone: "green" | "amber" | "purple" | "grey" }; hint?: string; finalPrice?: boolean; row?: boolean; acts: Act[] };

/** Which note and buttons an order card gets: the dashboard's renderSingleOrder, without the HTML. */
export function planFor(o: any, cartRows?: any[]): Plan {
  const live = (cartRows || [o]).filter((r) => !CLOSED.includes(r.status));
  // Same amount as the web dashboard note: paid_amount of the live rows.
  const paidTotal = (cartRows ? live : [o]).reduce((n, r) => n + (Number(r.paid_amount) || 0), 0);
  const rows = cartRows ? live : [o];
  const isDelivery = o.order_type === "delivery";
  const paidRzp = o.payment_method === "razorpay" || !!o.payment_verified_at;
  const pod = rows.filter((r) => r.pay_on_delivery);
  const podUnpaid = pod.some((r) => !r.razorpay_payment_id);
  const podAmount = rows.reduce((s, r) => s + (Number(r.pay_on_delivery && r.final_price != null ? r.final_price : r.total_price) || 0) + (Number(r.delivery_fee) || 0), 0);
  const needsPrice = rows.some((r) => preorderNeedsFinalPrice(r));
  const cancel: Act = { action: "seller_cancel", label: podUnpaid ? "Cancel order" : "Cancel order · refund buyer", kind: "danger" };
  const podNote = podUnpaid ? { text: `Pay on delivery · ₹${podAmount.toLocaleString("en-IN")}. The buyer pays in the Relifish app when you deliver. No cash. Hand it over once this shows Paid.`, tone: "amber" as const } : undefined;
  const s = o.status;

  if (podUnpaid && ["pending", "pending_payment"].includes(s))
    return { note: podNote, hint: "Next: Confirm the order. The buyer pays on delivery, in the app.", row: true, acts: [{ action: "accept", label: "✓ Confirm order", kind: "primary" }, { action: "decline", label: "Can't fulfill", kind: "danger" }] };
  if (["pending", "scheduled", "pending_payment", "pre_order"].includes(s)) {
    if (paidRzp) return { note: { text: "Payment received, confirm to start preparing", tone: "green" }, hint: "Next: Confirm the order.", acts: [{ action: "accept", label: "✓ Confirm order", kind: "primary" }] };
    return {
      note: { text: "⏳ Waiting for buyer to complete Razorpay payment.", tone: "grey" }, hint: "Waiting for buyer to complete Razorpay payment.",
      acts: [...(o.razorpay_order_id ? [{ action: "reconcile", label: "Check Razorpay for payment", kind: "secondary" as const }] : []), { action: "decline", label: "Can't fulfill", kind: "danger" }],
    };
  }
  if (s === "paid") return { note: { text: `Buyer paid ₹${paidTotal.toLocaleString("en-IN")}, confirm to accept the order`, tone: "green" }, hint: "Next: Confirm the order (or decline, the buyer is refunded in full).", row: true, acts: [{ action: "accept", label: "✓ Confirm order", kind: "primary" }, { action: "decline", label: "Can't fulfill", kind: "danger" }] };
  if (s === "confirmed") {
    // A cart sets the price per item on the website; the app only offers it on a single order.
    if (needsPrice) return { note: podNote, hint: "Next: Set final price before delivery or pickup.", finalPrice: !cartRows, acts: [cancel] };
    return { note: podNote, hint: isDelivery ? "Next: Mark as out for delivery." : "Next: Mark as ready for pickup.", acts: [isDelivery ? { action: "out_for_delivery", label: "Out for delivery", kind: "primary" } : { action: "ready", label: "Ready for pickup", kind: "primary" }, cancel] };
  }
  if (s === "ready_for_pickup" || s === "out_for_delivery") {
    const done = s === "ready_for_pickup" ? { action: "picked_up", label: "✓ Picked up" } : { action: "delivered", label: "✓ Delivered" };
    return {
      note: podNote ?? (pod.length ? { text: "Paid in the app, hand it over", tone: "green" } : undefined),
      hint: podUnpaid ? "Next: The buyer pays in the app. Hand it over once this shows Paid." : s === "ready_for_pickup" ? "Next: Mark as picked up when handed over." : "Next: Mark as delivered after drop-off.",
      acts: [
        ...(podUnpaid && o.razorpay_order_id ? [{ action: "reconcile", label: "Check payment", kind: "secondary" as const }] : []),
        podUnpaid ? { ...done, label: `${done.label} (after payment)`, kind: "success" as const, disabled: true } : { ...done, kind: "success" as const },
        ...(podUnpaid ? [{ action: "pod_refused", label: "Buyer didn't pay", kind: "danger" as const }] : []),
        cancel,
      ],
    };
  }
  if (s === "payment_required") return { note: { text: "⏳ Waiting for the buyer to pay the difference.", tone: "amber" }, hint: "Waiting: Buyer must pay the difference.", acts: [] };
  return { acts: [] };
}

/** "500 grams", "2 pack", "1kg": the dashboard's qtyLabelOf. */
export function qtyLabel(o: any) {
  const opt = (o.listing?.pricing_options || []).find((x: any) => x?.id && x.id === o.pricing_option_id);
  const bundle = opt?.bundle_size > 0 ? Number(opt.bundle_size) : 1;
  const unit = o.quantity_unit || "kg";
  const q = Number(o.quantity);
  return unit === "piece" && bundle > 1 ? `${Math.round(q / bundle)} pack` : unit === "kg" && q > 0 && q < 1 ? `${Math.round(q * 1000)} grams` : `${o.quantity}${unit}`;
}

/** POST to a seller route with the session's seller_id + phone, like the dashboard. */
export async function sellerPost<T = any>(path: string, body: Record<string, any>) {
  const me = await getSession();
  return api<T>(path, { seller_id: me?.seller_id, seller_phone: me?.phone, ...body });
}

/** "500 g", "kg", "3 pc", "pc": the amount one pack holds (dashboard packSize). */
export const packSize = (o: any) => {
  const bs = Number(o.bundle_size) || 1;
  if (o.unit === "kg") return bs < 1 ? `${Math.round(bs * 1000)} g` : bs === 1 ? "kg" : `${bs} kg`;
  return bs === 1 ? "pc" : `${bs} pc`;
};
