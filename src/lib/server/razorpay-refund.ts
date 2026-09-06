/**
 * Issue a Razorpay refund for a captured payment.
 *
 * BUG-44: this logic lived inline in /api/orders/cancel.ts (buyer-initiated
 * cancel) and nowhere else. The seller-initiated decline/cancel branch in
 * /api/seller/orders.ts only wrote `cancelled_by` and `refund_note` — no
 * refund call at all. The dashboard button is labelled
 * "✓ Confirm — refund buyer" and the resulting card tells the seller to send
 * the money over UPI, but for a Razorpay order the funds are in the platform's
 * Razorpay account, not the seller's, so the buyer got nothing.
 *
 * Never throws — returns the refund id when Razorpay accepted it, plus a note
 * safe to store on the order for the seller and support to read.
 */
export type RefundOutcome = {
  refundId: string | null;
  note: string;
  /** true only when Razorpay confirmed the refund; false means manual action needed. */
  ok: boolean;
};

export async function refundRazorpayPayment(
  razorpayPaymentId: string,
  ctx: { order_id?: string; caller?: string } = {}
): Promise<RefundOutcome> {
  const tag = ctx.caller || "razorpay-refund";
  const keyId = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
  const keySecret = import.meta.env.RAZORPAY_KEY_SECRET || "";

  if (!keyId || !keySecret) {
    return { refundId: null, ok: false, note: "Razorpay keys not configured — seller must refund manually" };
  }

  const authHex = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  try {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}/refund`, {
      method: "POST",
      headers: { Authorization: `Basic ${authHex}`, "Content-Type": "application/json" },
      body: JSON.stringify({ speed: "normal" }),
    });

    if (res.ok) {
      const body = await res.json();
      const refundId = body?.id || null;
      return { refundId, ok: true, note: `Razorpay refund ${refundId} initiated` };
    }

    const body = await res.json().catch(() => ({}));
    const desc = (body as any)?.error?.description || "unknown";
    console.warn(`[${tag}] razorpay refund failed`, { ...ctx, status: res.status, desc });
    return {
      refundId: null,
      ok: false,
      note: `Razorpay refund FAILED (${res.status}): ${desc} — seller must refund manually`,
    };
  } catch (err: any) {
    console.warn(`[${tag}] razorpay refund network error`, { ...ctx, err: err?.message });
    return {
      refundId: null,
      ok: false,
      note: `Razorpay refund FAILED (network): ${err?.message || "unknown"} — seller must refund manually`,
    };
  }
}

/** True when this order actually has Razorpay money against it to refund. */
export function isRazorpayPaid(order: { payment_method?: string | null; razorpay_payment_id?: string | null }): boolean {
  return order?.payment_method === "razorpay" && !!order?.razorpay_payment_id;
}
