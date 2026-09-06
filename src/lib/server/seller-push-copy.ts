import { priceUnitShortLabel } from "../listing-pricing";
import type { PriceUnit } from "../species";
import { fmtDateTimeFullIST } from "../format-ist";

/**
 * Seller Web Push copy, pure and unit-testable.
 *
 * BUG-26: /api/notify-seller previously understood only two kinds — "new_order"
 * and "payment_proof" — and coerced anything else to "payment_proof". The order
 * fan-out therefore told sellers "Payment proof received. Verify in dashboard."
 * when the buyer had CANCELLED, i.e. the exact opposite instruction from the
 * cancellation email arriving in the same second.
 */
export type SellerPushKind =
  | "new_order"
  | "payment_proof"
  | "payment_confirmed"
  | "cancelled"
  | "refunded";

const KINDS = new Set<SellerPushKind>([
  "new_order",
  "payment_proof",
  "payment_confirmed",
  "cancelled",
  "refunded",
]);

/** Unknown/missing kinds fall back to new_order (previous behaviour for that value). */
export function normalizeSellerPushKind(raw: unknown): SellerPushKind {
  return KINDS.has(raw as SellerPushKind) ? (raw as SellerPushKind) : "new_order";
}

export type SellerPushOpts = {
  species?: string | null;
  quantity?: number | string | null;
  quantity_unit?: string | null;
  scheduled_for?: string | null;
  placement_kind?: string | null;
  order_id_short?: string | null;
  amount?: number | null;
};

export function sellerPushNotification(
  kind: SellerPushKind,
  opts: SellerPushOpts = {}
): { title: string; body: string } {
  const species = opts.species || "";
  const id = opts.order_id_short ? String(opts.order_id_short).toUpperCase() : "";
  const idSuffix = id ? ` (order #${id})` : "";
  const amt = opts.amount != null ? ` ₹${opts.amount}` : "";

  switch (kind) {
    case "payment_proof":
      return {
        title: "Payment proof received",
        body: species
          ? `Buyer uploaded UPI proof for ${species}${idSuffix}. Verify in dashboard.`
          : `A buyer uploaded payment proof${idSuffix}. Verify in dashboard.`,
      };

    case "payment_confirmed":
      return {
        title: "Payment confirmed",
        body: species
          ? `Payment${amt} confirmed for ${species}${idSuffix}. Prepare this order.`
          : `Payment${amt} confirmed${idSuffix}. Prepare this order.`,
      };

    case "cancelled":
      return {
        title: "Order cancelled by buyer",
        body: species
          ? `Buyer cancelled their ${species} order${idSuffix}. Do not prepare it.`
          : `Buyer cancelled their order${idSuffix}. Do not prepare it.`,
      };

    case "refunded":
      return {
        title: "Refund processed",
        body: species
          ? `A refund${amt} was processed for ${species}${idSuffix}.`
          : `A refund${amt} was processed${idSuffix}.`,
      };

    case "new_order":
    default: {
      const u = String(opts.quantity_unit || "piece");
      const unitLabel = u === "piece" || u === "kg" ? priceUnitShortLabel(u as PriceUnit) : u;
      const isPreorder = opts.placement_kind === "preorder";
      const schedLabel = opts.scheduled_for ? ` (${fmtDateTimeFullIST(opts.scheduled_for)})` : "";
      return {
        title: isPreorder ? "New pre-order" : "New order",
        body: species
          ? `New${isPreorder ? " pre-order" : " order"}: ${species} ${opts.quantity ?? ""}${unitLabel}${schedLabel}`
          : `You have a new${isPreorder ? " pre-order" : " order"}${schedLabel}`,
      };
    }
  }
}
