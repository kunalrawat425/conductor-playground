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
  | "expired_unpaid"
  | "refunded"
  | "preorders_tomorrow";

const KINDS = new Set<SellerPushKind>([
  "new_order",
  "payment_proof",
  "payment_confirmed",
  "cancelled",
  "expired_unpaid",
  "refunded",
  "preorders_tomorrow",
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
  /** Buyer's cancellation reason, shown on the seller's lock screen. */
  reason?: string | null;
  /** Items in one cart; 2+ means `species` is a cart label and quantity is omitted. */
  item_count?: number | null;
  /** preorders_tomorrow: earliest delivery slot, e.g. "9–11 AM". */
  first_slot?: string | null;
  /** new_order / payment_confirmed: the buyer's delivery time, e.g. "Sat 24 Oct, 8–10 AM". */
  slot?: string | null;
};

export function sellerPushNotification(
  kind: SellerPushKind,
  opts: SellerPushOpts = {}
): { title: string; body: string } {
  const species = opts.species || "";
  const id = opts.order_id_short ? String(opts.order_id_short).toUpperCase() : "";
  const idSuffix = id ? ` (order #${id})` : "";
  const amt = opts.amount != null ? ` ₹${opts.amount}` : "";
  const deliver = opts.slot ? ` · Deliver ${opts.slot}` : "";

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
        title: "New paid order — confirm it",
        body: species
          ? `Buyer paid${amt} for ${species}${idSuffix}${deliver}. Open the dashboard to confirm or decline.`
          : `Buyer paid${amt}${idSuffix}${deliver}. Open the dashboard to confirm or decline.`,
      };

    case "cancelled": {
      const why = opts.reason ? ` Reason: ${opts.reason}.` : "";
      return {
        title: "Order cancelled by the buyer",
        body: species
          ? `The buyer cancelled their ${species} order${idSuffix}.${why} Do not prepare it.`
          : `The buyer cancelled their order${idSuffix}.${why} Do not prepare it.`,
      };
    }

    case "expired_unpaid":
      return {
        title: "Order expired unpaid",
        body: species
          ? `Buyer never paid for ${species}${idSuffix}. Cancelled automatically — do not prepare it.`
          : `Buyer never paid${idSuffix}. Cancelled automatically — do not prepare it.`,
      };

    case "refunded":
      return {
        title: "Refund processed",
        body: species
          ? `A refund${amt} was processed for ${species}${idSuffix}.`
          : `A refund${amt} was processed${idSuffix}.`,
      };

    case "preorders_tomorrow": {
      const n = opts.item_count ?? 0;
      return {
        title: "Tomorrow's deliveries",
        body: `Tomorrow: ${n} pre-order${n === 1 ? "" : "s"}${opts.first_slot ? `, first delivery ${opts.first_slot}` : ""}`,
      };
    }

    case "new_order":
    default: {
      const u = String(opts.quantity_unit || "piece");
      const unitLabel = u === "piece" || u === "kg" ? priceUnitShortLabel(u as PriceUnit) : u;
      const isPreorder = opts.placement_kind === "preorder";
      const schedLabel = opts.scheduled_for ? ` (${fmtDateTimeFullIST(opts.scheduled_for)})` : "";
      const many = (opts.item_count ?? 1) > 1;
      return {
        title: isPreorder ? "New pre-order" : "New order",
        body: species && many
          ? `New${isPreorder ? " pre-order" : " order"}: ${species} (${opts.item_count} items)${amt ? ` ·${amt}` : ""}${schedLabel}${deliver}`
          : species
          ? `New${isPreorder ? " pre-order" : " order"}: ${species} ${opts.quantity ?? ""}${unitLabel}${schedLabel}${deliver}`
          : `You have a new${isPreorder ? " pre-order" : " order"}${schedLabel}${deliver}`,
      };
    }
  }
}
