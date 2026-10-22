import { isPreorderShoppingWindow, type SellerTimingInput } from "./order-timing";
import { preorderDeadlineMs, slotDateIST } from "./delivery-slots";

/**
 * Can the BUYER cancel this order right now? Mirrors the published Refund &
 * Cancellation Policy (src/pages/refund-policy.astro) — shared by
 * /api/orders/cancel (enforcement) and the order page (button), so they agree.
 *
 *  - Not paid yet (pending / pending_payment / pre_order / scheduled), or paid
 *    but not yet accepted by the seller (paid): yes.
 *  - Seller raised the pre-order price (payment_required): yes — rejecting the
 *    updated price cancels with a full refund.
 *  - Confirmed, same-day: yes until the seller marks it Ready / out for delivery.
 *  - Confirmed pre-order: yes until the pre-order cutoff for its own delivery day
 *    (the slot's day when it has one: a Sunday pre-order placed on Thursday can be
 *    cancelled until Sunday's cutoff), else while the seller's pre-order window is
 *    still open (before their daily cutoff); or once the seller has set the price
 *    (the price-confirmation window). After cutoff with no price yet: no.
 *  - Ready / out for delivery / finished: no.
 *  - Late: a delivery more than LATE_CANCEL_GRACE_MIN past its slot end (or its
 *    "arriving by" time once out for delivery) and still open: yes (`late`).
 * Any paid amount is refunded in full.
 */
export function buyerCancelRule(
  o: LateInput & { is_preorder?: boolean | null; placement_kind?: string | null; final_price?: number | string | null },
  seller?: SellerTimingInput | null,
  nowMs?: number
): { ok: true; late?: boolean } | { ok: false; reason: string } {
  if (isOrderLate(o, nowMs)) return { ok: true, late: true };
  const s = String(o?.status || "");
  // Not paid, or paid but the seller hasn't accepted yet.
  if (["pending", "pending_payment", "pre_order", "scheduled", "paid", "payment_required"].includes(s)) return { ok: true };
  if (s !== "confirmed") return { ok: false, reason: `This order is already ${s.replace(/_/g, " ")} and can't be cancelled.` };
  const preorder = o.is_preorder === true || o.placement_kind === "preorder";
  if (!preorder) return { ok: true };
  if (o.final_price !== null && o.final_price !== undefined) return { ok: true };
  if (seller && o.delivery_slot_start) {
    if ((nowMs ?? Date.now()) < preorderDeadlineMs(seller, slotDateIST(o.delivery_slot_start))) return { ok: true };
  } else if (seller && isPreorderShoppingWindow(seller, nowMs)) return { ok: true };
  return { ok: false, reason: "The pre-order cutoff has passed — your fish is already being arranged." };
}

/** Minutes past the delivery slot end / "arriving by" time before the buyer may cancel a late order. */
export const LATE_CANCEL_GRACE_MIN = 60;

type LateInput = { status?: string | null; order_type?: string | null; delivery_slot_start?: string | null; delivery_slot_end?: string | null };
const LATE_DONE = ["completed", "picked_up", "delivered", "cancelled", "declined", "refunded"];

/** A delivery more than LATE_CANCEL_GRACE_MIN past its slot end (the "arriving by" time when out for delivery), not finished. */
export function isOrderLate(o: LateInput, nowMs = Date.now()): boolean {
  if (o?.order_type !== "delivery" || !o.delivery_slot_start || !o.delivery_slot_end) return false;
  if (LATE_DONE.includes(String(o.status || ""))) return false;
  const end = Date.parse(o.delivery_slot_end);
  return Number.isFinite(end) && nowMs > end + LATE_CANCEL_GRACE_MIN * 60_000;
}

/** Marks a buyer's late cancel inside cancel_reason (no extra column); stripped before display. */
const LATE_MARK = "late|";
export const lateCancelReason = (reason: string) => LATE_MARK + reason;
export const isLateCancel = (reason?: string | null) => String(reason || "").startsWith(LATE_MARK);

export const CANCEL_REASON_MIN = 5;
export const CANCEL_REASON_MAX = 200;
export const CANCEL_REASON_ERROR = "Please write a reason (at least 5 characters).";

/** The typed cancel reason, trimmed (and capped); an error when it is shorter than 5 characters. */
export function checkCancelReason(raw: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = String(raw ?? "").trim().replace(/^late\|/i, "").trim().slice(0, CANCEL_REASON_MAX);
  return reason.length >= CANCEL_REASON_MIN ? { ok: true, reason } : { ok: false, error: CANCEL_REASON_ERROR };
}

export type CancelActor = "buyer" | "seller" | "system" | "admin" | "unknown" | null | undefined;

/** "Who cancelled" in words, from the point of view of the person reading it. */
export function cancelledByText(by: CancelActor, viewer: "buyer" | "seller", cancelReason?: string | null): string {
  if (cancelReason === "auto_expired_payment" || by === "system") return "Cancelled automatically — payment was not completed in time";
  const late = isLateCancel(cancelReason) ? " — order was late" : "";
  if (by === "buyer") return (viewer === "buyer" ? "Cancelled by you" : "Cancelled by the buyer") + late;
  if (by === "seller") return viewer === "seller" ? "Cancelled by you" : "Cancelled — your order couldn't be fulfilled";
  if (by === "admin") return "Cancelled by Relifish support";
  return "Cancelled";
}

/** The human reason, or null for system codes / empty. */
export function cancelReasonText(reason?: string | null): string | null {
  const r = String(reason || "").replace(/^late\|/, "").trim();
  if (!r || r === "auto_expired_payment" || r.startsWith("e2e:")) return null;
  return r.slice(0, 200);
}
