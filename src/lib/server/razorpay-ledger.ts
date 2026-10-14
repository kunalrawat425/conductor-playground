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
import { gaPurchase } from "./ga-mp";
import { afterResponse } from "./after-response";
import { paymentSiblings, refundedPaiseForOrder, CART_PAYABLE, isLiveRow } from "./order-cart";

export const PAYABLE_STATUSES = ["pending", "pending_payment", "payment_required"];
const CLOSED_STATUSES = ["cancelled", "declined", "refunded"];
const ORDER_COLS = "id, buyer_id, status, final_price, paid_amount, razorpay_order_id, razorpay_payment_id, refund_note, total_price, delivery_fee, created_at";

export type SettleOrder = {
  id: string;
  status: string;
  razorpay_order_id?: string | null;
  razorpay_payment_id?: string | null;
  final_price?: number | string | null;
  refund_note?: string | null;
  total_price?: number | string | null;
  delivery_fee?: number | string | null;
};

export type Settlement = "confirm" | "already" | "stamp" | "refund";

/**
 * One Razorpay payment can cover a whole cart (several order rows, see order-cart.ts).
 * Each row is decided on its own; rows that can't keep the money get their share back.
 * Pure, so the money rules are unit-testable.
 */
export function planCartSettlement<T extends SettleOrder>(
  rows: T[],
  p: { razorpay_order_id: string; razorpay_payment_id: string }
): Record<Settlement, T[]> {
  const plan: Record<Settlement, T[]> = { confirm: [], already: [], stamp: [], refund: [] };
  for (const r of rows) {
    const d = decideSettlement(r, p);
    // A cart payment never settles a balance top-up: those have their own Razorpay order.
    plan[d === "confirm" && !CART_PAYABLE.includes(r.status) ? "refund" : d].push(r);
  }
  return plan;
}

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
  return (await findOrdersForRazorpayOrder(sb, razorpayOrderId))[0] ?? null;
}

/** Every row a Razorpay order charges for: one row, or a whole cart (oldest first). */
export async function findOrdersForRazorpayOrder(sb: any, razorpayOrderId: string): Promise<SettleOrder[]> {
  const { data } = await sb.from("orders").select(ORDER_COLS).eq("razorpay_order_id", razorpayOrderId)
    .order("created_at", { ascending: true });
  if (data?.length) return data;
  const receipt = await orderIdFromReceipt(razorpayOrderId);
  if (!receipt) return [];
  const { data: byReceipt } = await sb.from("orders").select(ORDER_COLS).eq("id", receipt).limit(1);
  return byReceipt ?? [];
}

export type SettleResult =
  /** `orders`: every row this call moved (2+ for a cart paid in one go). */
  | { kind: "confirmed" | "already" | "stamped"; order: SettleOrder; orders?: SettleOrder[] }
  | { kind: "refunded"; order: SettleOrder; refund: RefundOutcome }
  | { kind: "orphan" };

type SettleInput = { razorpay_order_id: string; razorpay_payment_id: string; source: string; verified_by?: string | null };

export async function settleCapturedPayment(sb: any, p: SettleInput): Promise<SettleResult> {
  const rows = await findOrdersForRazorpayOrder(sb, p.razorpay_order_id);
  if (!rows.length) return { kind: "orphan" };
  if (rows.length > 1) return settleCart(sb, rows, p);
  let order = rows[0];

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
        update.paid_amount = Number(order.final_price) + Number(order.delivery_fee || 0); // fish + delivery
      }
      const { data, error } = await sb.from("orders").update(update)
        .eq("id", order.id).eq("status", order.status).select(ORDER_COLS);
      if (error) throw new Error(`confirm failed: ${error.message}`);
      if (data?.[0]) {
        // The guarded UPDATE succeeds once per payment, so GA gets exactly one purchase (whichever path won).
        afterResponse(gaPurchase(p.razorpay_order_id, { order_id: order.id }), "ga-mp:purchase");
        return { kind: "confirmed", order: data[0] };
      }
    } else if (decision === "stamp") {
      const { data, error } = await sb.from("orders")
        .update({ payment_method: "razorpay", razorpay_payment_id: p.razorpay_payment_id })
        .eq("id", order.id).is("razorpay_payment_id", null).select(ORDER_COLS);
      if (error) throw new Error(`stamp failed: ${error.message}`);
      if (data?.[0]) {
        afterResponse(gaPurchase(p.razorpay_order_id, { order_id: order.id }), "ga-mp:purchase"); // money kept on this order: a purchase too
        return { kind: "stamped", order: data[0] };
      }
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

/**
 * A cart paid by one payment. Rows still awaiting it move to paid in ONE guarded
 * UPDATE, so of two concurrent settles (verify + webhook) exactly one gets them and
 * notifies. Rows that can't keep the money (closed meanwhile, paid by another
 * payment) get their own share refunded; if none can keep it, the whole payment is.
 */
async function settleCart(sb: any, rows: SettleOrder[], p: SettleInput): Promise<SettleResult> {
  const primary = rows[0];
  await recordRazorpayPayment(sb, {
    razorpay_payment_id: p.razorpay_payment_id,
    razorpay_order_id: p.razorpay_order_id,
    order_id: primary.id,
    source: p.source,
  });
  const plan = planCartSettlement(rows, p);
  if (plan.refund.length === rows.length) return refundLatePayment(sb, primary, p);

  const now = new Date().toISOString();
  const confirmed: SettleOrder[] = [];
  const stamped: SettleOrder[] = [];
  if (plan.confirm.length) {
    const { data, error } = await sb.from("orders").update({
      status: "paid",
      payment_method: "razorpay",
      razorpay_payment_id: p.razorpay_payment_id,
      payment_verified_at: now,
      payment_verified_by: p.verified_by ?? null,
    })
      .in("id", plan.confirm.map((r) => r.id))
      .in("status", CART_PAYABLE)
      .eq("razorpay_order_id", p.razorpay_order_id)
      .is("razorpay_payment_id", null)
      .select(ORDER_COLS);
    if (error) throw new Error(`cart confirm failed: ${error.message}`);
    confirmed.push(...(data || []));
  }
  if (plan.stamp.length) {
    const { data, error } = await sb.from("orders")
      .update({ payment_method: "razorpay", razorpay_payment_id: p.razorpay_payment_id })
      .in("id", plan.stamp.map((r) => r.id)).is("razorpay_payment_id", null).select(ORDER_COLS);
    if (error) throw new Error(`cart stamp failed: ${error.message}`);
    stamped.push(...(data || []));
  }
  if (confirmed.length || stamped.length) {
    afterResponse(gaPurchase(p.razorpay_order_id, { order_id: (confirmed[0] || stamped[0]).id }), "ga-mp:purchase");
  }

  // Rows another writer changed between our read and our UPDATE: theirs if this
  // payment is now on them, otherwise this payment can't stay on them.
  const moved = new Set([...confirmed, ...stamped].map((r) => r.id));
  const lost = [...plan.confirm, ...plan.stamp].filter((r) => !moved.has(r.id));
  const refundRows = [...plan.refund];
  if (lost.length) {
    const { data: fresh } = await sb.from("orders").select(ORDER_COLS).in("id", lost.map((r) => r.id));
    for (const f of fresh || []) if (f.razorpay_payment_id !== p.razorpay_payment_id) refundRows.push(f);
  }
  let lastRefund: RefundOutcome | null = null;
  for (const r of refundRows) lastRefund = await refundCartShare(sb, r, p);

  // Oldest row first: it is the order number the buyer saw at checkout.
  const byAge = (a: SettleOrder, b: SettleOrder) => String((a as any).created_at || "").localeCompare(String((b as any).created_at || ""));
  confirmed.sort(byAge);
  stamped.sort(byAge);
  if (confirmed.length) return { kind: "confirmed", order: confirmed[0], orders: confirmed };
  if (stamped.length) return { kind: "stamped", order: stamped[0], orders: stamped };
  if (lastRefund) return { kind: "refunded", order: refundRows[0], refund: lastRefund };
  return { kind: "already", order: plan.already[0] ?? primary };
}

/** Refund one row's share of a cart payment (never repeated: refunds carry notes.order_id). */
async function refundCartShare(sb: any, row: SettleOrder, p: { razorpay_payment_id: string; source: string }): Promise<RefundOutcome> {
  // Other items of the cart kept the payment, so the delivery still happens: item price only.
  const outcome = await refundShare(row, p.razorpay_payment_id, `settle:${p.source}`, false);
  console.warn("[razorpay-ledger] cart payment share could not be applied to its item — refunding", {
    order_id: row.id, status: row.status, razorpay_payment_id: p.razorpay_payment_id, ok: outcome.ok,
  });
  const line = `Cart payment ${p.razorpay_payment_id} share on a ${row.status} item: ${outcome.note}`;
  const patch: Record<string, unknown> = { refund_note: (row.refund_note ? `${row.refund_note} | ${line}` : line).slice(0, 1000) };
  // Attach the payment to an item that has none, so the buyer sees "Refund pending"
  // and the daily cron retries a failed refund.
  if (!row.razorpay_payment_id) {
    patch.payment_method = "razorpay";
    patch.razorpay_payment_id = p.razorpay_payment_id;
    if (outcome.ok) {
      patch.refund_amt = outcome.refundedRupees ?? Number(row.total_price || 0);
      patch.refund_sent_at = new Date().toISOString();
    }
  }
  const { error } = await sb.from("orders").update(patch).eq("id", row.id);
  if (error) console.error("[razorpay-ledger] cart share refund note write failed", { order_id: row.id, err: error.message });
  return outcome;
}

/**
 * Partial refund of what one row paid on a shared payment, minus what it already
 * got back. The delivery fee (carried by one row of the cart) comes back only with
 * the LAST live item: removing one item while the rest is still delivered refunds
 * that item's price alone.
 */
async function refundShare(
  row: { id: string; total_price?: number | string | null; delivery_fee?: number | string | null },
  paymentId: string,
  caller: string,
  includeFee: boolean
): Promise<RefundOutcome> {
  const due = Math.round((Number(row.total_price || 0) + (includeFee ? Number(row.delivery_fee || 0) : 0)) * 100);
  const already = await refundedPaiseForOrder(paymentId, row.id);
  // Never refund blind on a shared payment: a repeat would hand back another item's money.
  if (already === null) return { refundId: null, ok: false, note: "Razorpay refund FAILED (could not check earlier refunds) — retried automatically" };
  if (already >= due) return { refundId: null, ok: true, note: "Already refunded on Razorpay", refundedRupees: already / 100 };
  const out = await refundRazorpayPayment(paymentId, { order_id: row.id, caller }, due - already);
  return { ...out, refundedRupees: (out.ok ? due : already) / 100 };
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
  const pid = order.razorpay_payment_id;
  // A cart paid in one go: this item gets back only its own share of that payment.
  // The ledger's refund_id is per payment, so it can't say whether THIS share is done.
  const shared = pid ? (await paymentSiblings(sb, pid, order.id)).length > 0 : false;
  const ids = ledger.filter((r) => !r.refund_id && !(shared && r.razorpay_payment_id === pid)).map((r) => r.razorpay_payment_id);
  if (pid && !shared && !ledger.some((r) => r.razorpay_payment_id === pid)) ids.push(pid);
  if (!ids.length && !shared) return { refundId: null, ok: true, note: "Nothing left to refund on Razorpay" };

  const outcomes: RefundOutcome[] = [];
  let refundedRupees: number | undefined;
  if (shared && pid) {
    const { data: row } = await sb.from("orders").select("id, cart_id, total_price, delivery_fee").eq("id", order.id).maybeSingle();
    const { data: others } = row?.cart_id
      ? await sb.from("orders").select("id, status, total_price, delivery_fee, razorpay_payment_id, refund_note").eq("cart_id", row.cart_id).neq("id", order.id)
      : { data: [] as any[] };
    const last = !(others || []).some((o: any) => isLiveRow(o.status));
    const own = row
      ? await refundShare(row, pid, ctx.caller, last)
      : { refundId: null, ok: false, note: "Razorpay refund FAILED (order row not found) — retried automatically" };
    outcomes.push(own);
    refundedRupees = own.refundedRupees;
    // Last item gone: the delivery fee sits on an item removed earlier — give it back now.
    if (last) {
      for (const f of (others || []).filter((o: any) => Number(o.delivery_fee) > 0 && o.razorpay_payment_id === pid)) {
        const fee = await refundShare(f, pid, ctx.caller, true);
        outcomes.push(fee);
        if (fee.ok && fee.refundedRupees != null) {
          await sb.from("orders").update({
            refund_amt: fee.refundedRupees,
            refund_note: `${f.refund_note ? f.refund_note + " | " : ""}Delivery fee refunded with the last item: ${fee.note}`.slice(0, 1000),
          }).eq("id", f.id);
        }
      }
    }
  }
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
    refundedRupees,
  };
}
