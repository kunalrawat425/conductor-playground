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
  | "preorders_tomorrow"
  | "pay_on_delivery"
  | "pod_paid";

const KINDS = new Set<SellerPushKind>([
  "new_order",
  "payment_proof",
  "payment_confirmed",
  "cancelled",
  "expired_unpaid",
  "refunded",
  "preorders_tomorrow",
  "pay_on_delivery",
  "pod_paid",
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

    case "pay_on_delivery":
      return {
        title: "New order · Pay on delivery",
        body: `${species ? `${species}${idSuffix}` : `New order${idSuffix}`}${amt ? ` ·${amt}` : ""}${deliver}. The buyer pays in the app when you deliver. Confirm or decline.`,
      };

    case "pod_paid":
      return {
        title: "Paid ✅ — hand it over",
        body: `The buyer paid${amt}${species ? ` for ${species}` : ""}${idSuffix}. Mark it delivered once they have it.`,
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

/** The seller's SMS for a new order to act on (DLT template SELLER_ORDER, lib/server/sms.ts). Pure. */
export function sellerOrderSms(kind: SellerPushKind, orderId: string, amount: number | null, slot: string | null): { key: "SELLER_ORDER"; vars: string[] } {
  const rs = amount != null ? `Rs.${Math.round(amount)}` : "Amount in dashboard";
  return {
    key: "SELLER_ORDER",
    vars: [`#${orderId.slice(0, 8).toUpperCase()}`, kind === "pay_on_delivery" ? `${rs}, pays on delivery` : `${rs} paid`, slot || "as agreed"],
  };
}

/**
 * Who gets the new-order SMS: the seller, plus a copy to each ORDER_COPY_PHONES number
 * (comma list). Each has its own dedupe key; a copy number that is the seller's own is skipped.
 */
export function orderSmsRecipients(sellerPhone: string | null | undefined, copyPhones: string, orderId: string): [string, string][] {
  const ten = (p: string) => String(p || "").replace(/\D/g, "").slice(-10);
  const out: [string, string][] = sellerPhone ? [[sellerPhone, `seller_order:${orderId}`]] : [];
  for (const p of copyPhones.split(",").map(ten).filter((p) => p.length === 10)) {
    if (out.some(([q]) => ten(q) === p)) continue;
    out.push([p, `seller_order:${orderId}:copy:${p}`]);
  }
  return out;
}
