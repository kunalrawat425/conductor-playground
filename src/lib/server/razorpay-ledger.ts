/**
 * One place that decides what a captured Razorpay payment does to its order.
 *
 * Before this, six paths (verify, webhook, daily cron, admin bulk reconcile,
 * seller "Check Razorpay", create-order's already-paid branch) each wrote their
 * own UPDATE, and each only matched pending rows. A payment that landed after
 * the order was cancelled/declined matched zero rows: the money stayed captured,
 * nothing refunded it, and the webhook logged "already in status cancelled — OK".
 * A second payment on an already-paid order (two tabs) was the same. A balance
 * top-up overwrote the upfront payment id, the only handle a refund has.
 *
 * Every captured payment is now recorded in `razorpay_payments` (migration 069)
 * and settled exactly once:
 *   confirm  — order still awaiting this payment → paid (seller then confirms);
 *              a balance top-up returns the order to confirmed
 *   already  — this payment is already on the order → no-op
 *   stamp    — order moved on without a payment id (seller confirmed first) → attach id
 *   refund   — order closed, already paid by another payment, or the payment was
 *              for a superseded amount → refund this payment, never keep it silently
 */
import { refundRazorpayPayment, type RefundOutcome } from "./razorpay-refund";

export const PAYABLE_STATUSES = ["pending", "pending_payment", "payment_required"];
const CLOSED_STATUSES = ["cancelled", "declined", "refunded"];
const ORDER_COLS = "id, buyer_id, status, final_price, paid_amount, razorpay_order_id, razorpay_payment_id, refund_note";

export type SettleOrder = {
  id: string;
  status: string;
  razorpay_order_id?: string | null;
  razorpay_payment_id?: string | null;
  final_price?: number | string | null;
  refund_note?: string | null;
};

export type Settlement = "confirm" | "already" | "stamp" | "refund";

/** Pure decision, so the money rules are unit-testable without a database. */
export function decideSettlement(
  order: SettleOrder,
  p: { razorpay_order_id: string; razorpay_payment_id: string }
): Settlement {
  if (order.razorpay_payment_id === p.razorpay_payment_id) return "already";
  const forCurrentAmount = order.razorpay_order_id === p.razorpay_order_id;
  if (forCurrentAmount && PAYABLE_STATUSES.includes(order.status)) return "confirm";
  if (forCurrentAmount && !order.razorpay_payment_id && !CLOSED_STATUSES.includes(order.status)) return "stamp";
  return "refund";
}

export async function recordRazorpayPayment(
  sb: any,
  row: { razorpay_payment_id: string; razorpay_order_id: string; order_id: string | null; source: string }
): Promise<void> {
  const { error } = await sb
    .from("razorpay_payments")
    .upsert(row, { onConflict: "razorpay_payment_id", ignoreDuplicates: true });
  // The orders row stays the primary record; a ledger miss must never block a payment.
  if (error) console.error("[razorpay-ledger] could not record payment", { ...row, err: error.message });
}

/** Our order id, from the Razorpay order's `receipt` (set at creation). */
async function orderIdFromReceipt(razorpayOrderId: string): Promise<string | null> {
  const keyId = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
  const keySecret = import.meta.env.RAZORPAY_KEY_SECRET || "";
  if (!keyId || !keySecret) return null;
  try {
    const res = await fetch(`https://api.razorpay.com/v1/orders/${razorpayOrderId}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.receipt === "string" && body.receipt ? body.receipt : null;
  } catch {
    return null;
  }
}

/**
 * Find the order a payment belongs to. `razorpay_order_id` first; if the row's
 * id was since replaced (amount changed, second tab), fall back to the receipt.
 */
export async function findOrderForRazorpayOrder(sb: any, razorpayOrderId: string): Promise<SettleOrder | null> {
  const { data } = await sb.from("orders").select(ORDER_COLS).eq("razorpay_order_id", razorpayOrderId).limit(1);
  if (data?.[0]) return data[0];
  const receipt = await orderIdFromReceipt(razorpayOrderId);
  if (!receipt) return null;
  const { data: byReceipt } = await sb.from("orders").select(ORDER_COLS).eq("id", receipt).limit(1);
  return byReceipt?.[0] ?? null;
}

export type SettleResult =
  | { kind: "confirmed" | "already" | "stamped"; order: SettleOrder }
  | { kind: "refunded"; order: SettleOrder; refund: RefundOutcome }
  | { kind: "orphan" };

export async function settleCapturedPayment(
  sb: any,
  p: { razorpay_order_id: string; razorpay_payment_id: string; source: string; verified_by?: string | null }
): Promise<SettleResult> {
  let order = await findOrderForRazorpayOrder(sb, p.razorpay_order_id);
  if (!order) return { kind: "orphan" };

  await recordRazorpayPayment(sb, {
    razorpay_payment_id: p.razorpay_payment_id,
    razorpay_order_id: p.razorpay_order_id,
    order_id: order.id,
    source: p.source,
  });

  // Two passes at most: if a concurrent writer changed the row between our read
  // and our guarded UPDATE, re-read and decide again on the fresh state.
  for (let pass = 0; pass < 2; pass++) {
    const decision = decideSettlement(order, p);

    if (decision === "already") return { kind: "already", order };

    if (decision === "confirm") {
      // Business rule: a payment makes the order PAID; only the seller's accept
      // makes it CONFIRMED. A balance top-up returns an already-accepted
      // pre-order to confirmed.
      const update: Record<string, unknown> = {
        status: order.status === "payment_required" ? "confirmed" : "paid",
        payment_method: "razorpay",
        razorpay_payment_id: p.razorpay_payment_id,
        payment_verified_at: new Date().toISOString(),
        payment_verified_by: p.verified_by ?? null,
      };
      // BUG-47: after a balance top-up the buyer has paid the full final price.
      if (order.status === "payment_required" && order.final_price != null) {
        update.paid_amount = Number(order.final_price);
      }
      const { data, error } = await sb.from("orders").update(update)
        .eq("id", order.id).eq("status", order.status).select(ORDER_COLS);
      if (error) throw new Error(`confirm failed: ${error.message}`);
      if (data?.[0]) return { kind: "confirmed", order: data[0] };
    } else if (decision === "stamp") {
      const { data, error } = await sb.from("orders")
        .update({ payment_method: "razorpay", razorpay_payment_id: p.razorpay_payment_id })
        .eq("id", order.id).is("razorpay_payment_id", null).select(ORDER_COLS);
      if (error) throw new Error(`stamp failed: ${error.message}`);
      if (data?.[0]) return { kind: "stamped", order: data[0] };
    } else {
      return refundLatePayment(sb, order, p);
    }

    const { data: fresh } = await sb.from("orders").select(ORDER_COLS).eq("id", order.id).single();
    if (!fresh) return { kind: "orphan" };
    order = fresh;
  }
  // Still contended after a re-read: never keep money we could not attach.
  return refundLatePayment(sb, order, p);
}

async function refundLatePayment(
  sb: any,
  order: SettleOrder,
  p: { razorpay_payment_id: string; source: string }
): Promise<SettleResult> {
  // Already refunded on an earlier pass (the cron re-scans closed orders daily).
  const { data: prior } = await sb.from("razorpay_payments")
    .select("refund_id").eq("razorpay_payment_id", p.razorpay_payment_id).maybeSingle();
  if (prior?.refund_id) {
    return { kind: "refunded", order, refund: { refundId: prior.refund_id, ok: true, note: "already refunded" } };
  }
  const refund = await refundRazorpayPayment(p.razorpay_payment_id, { order_id: order.id, caller: `settle:${p.source}` });
  console.warn("[razorpay-ledger] payment could not be applied to its order — refunding", {
    order_id: order.id, status: order.status, razorpay_payment_id: p.razorpay_payment_id, ok: refund.ok,
  });
  if (refund.refundId) {
    await sb.from("razorpay_payments")
      .update({ refund_id: refund.refundId, refunded_at: new Date().toISOString() })
      .eq("razorpay_payment_id", p.razorpay_payment_id);
  }
  const line = `Extra payment ${p.razorpay_payment_id} on a ${order.status} order: ${refund.note}`;
  const note = order.refund_note ? `${order.refund_note} | ${line}` : line;
  const { error } = await sb.from("orders").update({ refund_note: note.slice(0, 1000) }).eq("id", order.id);
  if (error) console.error("[razorpay-ledger] refund note write failed", { order_id: order.id, err: error.message });
  return { kind: "refunded", order, refund };
}

/**
 * Refund every Razorpay payment on an order that has not been refunded yet:
 * the upfront payment and any balance top-up. Falls back to the order's own
 * `razorpay_payment_id` when the ledger has no row (pre-069 orders, or the
 * table not migrated yet). Never throws.
 */
export async function refundOrderRazorpay(
  sb: any,
  order: { id: string; razorpay_payment_id?: string | null; razorpay_order_id?: string | null },
  ctx: { caller: string }
): Promise<RefundOutcome> {
  const { data: rows, error } = await sb
    .from("razorpay_payments")
    .select("razorpay_payment_id, refund_id")
    .eq("order_id", order.id);
  if (error) console.warn("[razorpay-ledger] ledger read failed, using order row only", { order_id: order.id, err: error.message });

  const ledger: { razorpay_payment_id: string; refund_id: string | null }[] = rows || [];
  const ids = ledger.filter((r) => !r.refund_id).map((r) => r.razorpay_payment_id);
  const pid = order.razorpay_payment_id;
  if (pid && !ledger.some((r) => r.razorpay_payment_id === pid)) ids.push(pid);
  if (!ids.length) return { refundId: null, ok: true, note: "Nothing left to refund on Razorpay" };

  const outcomes: RefundOutcome[] = [];
  for (const id of ids) {
    const outcome = await refundRazorpayPayment(id, { order_id: order.id, caller: ctx.caller });
    outcomes.push(outcome);
    if (outcome.refundId) {
      await recordRazorpayPayment(sb, {
        razorpay_payment_id: id, razorpay_order_id: order.razorpay_order_id || "", order_id: order.id, source: ctx.caller,
      });
      await sb.from("razorpay_payments")
        .update({ refund_id: outcome.refundId, refunded_at: new Date().toISOString() })
        .eq("razorpay_payment_id", id);
    }
  }
  return {
    ok: outcomes.every((o) => o.ok),
    refundId: outcomes.map((o) => o.refundId).filter(Boolean).join(",") || null,
    note: outcomes.map((o) => o.note).join(" | "),
  };
}
