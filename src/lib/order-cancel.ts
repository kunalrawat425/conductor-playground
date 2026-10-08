import { isPreorderShoppingWindow, type SellerTimingInput } from "./order-timing";

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
 *  - Confirmed pre-order: yes while the seller's pre-order window is still open
 *    (before their daily cutoff), or once the seller has set the morning price
 *    (the price-confirmation window). After cutoff with no price yet: no.
 *  - Ready / out for delivery / finished: no.
 * Any paid amount is refunded in full.
 */
export function buyerCancelRule(
  o: { status?: string | null; is_preorder?: boolean | null; placement_kind?: string | null; final_price?: number | string | null },
  seller?: SellerTimingInput | null,
  nowMs?: number
): { ok: true } | { ok: false; reason: string } {
  const s = String(o?.status || "");
  // Not paid, or paid but the seller hasn't accepted yet.
  if (["pending", "pending_payment", "pre_order", "scheduled", "paid", "payment_required"].includes(s)) return { ok: true };
  if (s !== "confirmed") return { ok: false, reason: `This order is already ${s.replace(/_/g, " ")} and can't be cancelled.` };
  const preorder = o.is_preorder === true || o.placement_kind === "preorder";
  if (!preorder) return { ok: true };
  if (o.final_price !== null && o.final_price !== undefined) return { ok: true };
  if (seller && isPreorderShoppingWindow(seller, nowMs)) return { ok: true };
  return { ok: false, reason: "The pre-order cutoff has passed — the seller is already sourcing your catch." };
}
