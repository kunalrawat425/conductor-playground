import type { APIRoute } from "astro";
import { requireBuyer } from "../../../lib/server/session";
import { createClient } from "@supabase/supabase-js";
import { sendBuyerOrderPush } from "../../../lib/server/buyer-push";
import { isRazorpayPaid } from "../../../lib/server/razorpay-refund";
import { refundOrderRazorpay } from "../../../lib/server/razorpay-ledger";
import { buyerCancelRule } from "../../../lib/order-cancel";
import { isLiveRow, moveFeeOffClosedRow } from "../../../lib/server/order-cart";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

export const POST: APIRoute = async ({ request, url }) => {
  try {
    const { order_id, buyer_id, action, cancel_reason, whole_cart } = await request.json();
    { const denied = requireBuyer(request, buyer_id); if (denied) return denied; }
    if (!order_id || !buyer_id) {
      return new Response(JSON.stringify({ error: "order_id and buyer_id required" }), { status: 400 });
    }

    const sb = createClient(supabaseUrl, supabaseServiceKey);

    const { data: order } = await sb.from("orders").select("*").eq("id", order_id).eq("buyer_id", buyer_id).single();
    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
    }

    // Cancel: allowed before fulfillment starts.
    // Pre-payment states: cancel immediately, no refund needed.
    // Confirmed state: allowed ONLY if seller has not yet marked ready / dispatched.
    //   If paid via Razorpay, trigger auto-refund.
    if (action === "cancel") {
      // whole_cart: cancel every live item of this checkout in one go, ONE notification.
      let targets: any[] = [order];
      if (whole_cart && order.cart_id) {
        const { data: siblings } = await sb.from("orders").select("*")
          .eq("cart_id", order.cart_id).eq("buyer_id", buyer_id)
          .not("status", "in", "(cancelled,declined,refunded,completed,picked_up)");
        if (siblings?.length) targets = siblings;
      }
      // Removing one item must not take the rest of the cart under the seller's minimum.
      if (!whole_cart && order.cart_id && order.listing_id) {
        const { data: rest } = await sb.from("orders").select("id, status, total_price")
          .eq("cart_id", order.cart_id).eq("buyer_id", buyer_id).neq("id", order.id);
        const live = (rest || []).filter((r: any) => isLiveRow(r.status));
        if (live.length) {
          const { data: l } = await sb.from("fish_listings").select("seller:sellers(min_order_amount)").eq("id", order.listing_id).maybeSingle();
          const min = Number((l as any)?.seller?.min_order_amount) || 0;
          const left = live.reduce((sum: number, r: any) => sum + Number(r.total_price || 0), 0);
          if (min > 0 && left < min) {
            return new Response(JSON.stringify({ error: `The rest of the order would be under the ₹${min} minimum. Cancel the whole order instead.` }), { status: 400 });
          }
        }
      }
      const reason = String(cancel_reason || "").trim().slice(0, 200) || null;
      const done: { id: string; paid: boolean; refundId: string | null; refundNote: string | null; refundAmt: number }[] = [];
      let firstError: { error: string; status: number } | null = null;
      for (const row of targets) {
        const r = await cancelRow(sb, row, reason);
        if ("error" in r) { firstError ??= r; continue; }
        done.push(r);
      }
      if (!done.length) {
        const e = firstError ?? { error: "Nothing to cancel", status: 400 };
        return new Response(JSON.stringify({ error: e.error }), { status: e.status });
      }

      // BUG-20 + BUG-25: previously only the buyer got a push here — the seller
      // was told NOTHING, so they could prep an order cancelled hours earlier.
      // Now both parties get push + email — once for everything cancelled here.
      const paidBack = done.filter((d) => d.paid).reduce((sum, d) => sum + d.refundAmt, 0);
      let notified: unknown = null;
      try {
        const { notifyOrderParties } = await import("../../../lib/server/notify-order-parties");
        notified = await notifyOrderParties({
          order_id: done[0].id,
          event: "cancelled_by_buyer",
          origin: url.origin,
          amount: paidBack > 0 ? paidBack : null,
          order_ids: done.map((d) => d.id),
        });
      } catch (err) {
        console.warn("[cancel] notify fan-out failed", { order_id, err: (err as any)?.message });
      }

      const isRzpPaid = done.some((d) => d.paid);
      return new Response(JSON.stringify({
        success: true,
        status: "cancelled",
        cancelled: done.map((d) => d.id),
        refund: isRzpPaid ? { auto: done.every((d) => !d.paid || !!d.refundId), id: done.map((d) => d.refundId).filter(Boolean).join(",") || null, note: done.map((d) => d.refundNote).filter(Boolean).join(" | ") } : null,
        notified,
      }), { status: 200 });
    }

    // Accept pre-order final price — buyer accepts, now move to confirmed.
    // Also stamp payment_verified_at so the row satisfies "confirmed → has proof"
    // invariant (BUG-5 fix: prior rows lacked verified_at, causing 29 audit hits).
    if (action === "accept_price") {
      if (order.status !== "pre_order" || !order.final_price) {
        return new Response(JSON.stringify({ error: "No price to accept" }), { status: 400 });
      }
      // BUG-35: `payment_verified_by` is a uuid column, so writing the string
      // "buyer_accept_price" raised 22P02 and the whole UPDATE was rejected.
      // The error was discarded, so this endpoint returned
      // 200 {"success":true,"status":"confirmed"} while the row stayed
      // `pre_order` — the buyer tapped Accept price, saw success, and nothing
      // happened. `payment_verified_at` alone satisfies the BUG-5 invariant.
      const { error: acceptErr } = await sb.from("orders").update({
        status: "confirmed",
        payment_verified_at: order.payment_verified_at || new Date().toISOString(),
        payment_verified_by: order.payment_verified_by || null,
      }).eq("id", order_id);

      if (acceptErr) {
        console.error("[cancel:accept_price] update failed", { order_id, err: acceptErr.message });
        return new Response(JSON.stringify({ error: acceptErr.message }), { status: 500 });
      }

      try {
        await sendBuyerOrderPush({
          buyer_id,
          buyer_phone: order.buyer_phone ?? null,
          status: "confirmed",
          species: order.species || "Fish",
          order_id,
        });
      } catch (err) { console.warn("[cancel:accept_price] buyer push failed", { order_id, err: (err as any)?.message }); }

      return new Response(JSON.stringify({ success: true, status: "confirmed" }), { status: 200 });
    }

    // Reject pre-order final price
    if (action === "reject_price") {
      if (!order.final_price) {
        return new Response(JSON.stringify({ error: "No price to reject" }), { status: 400 });
      }

      // BUG-38: trigger handles the restore — see the note in the cancel branch.

      const { error: rejectErr } = await sb.from("orders").update({ status: "cancelled", refund_amt: order.paid_amount, cancelled_by: "buyer", cancel_reason: "Price rejected by buyer" }).eq("id", order_id);
      if (rejectErr) {
        console.error("[cancel:reject_price] update failed", { order_id, err: rejectErr.message });
        return new Response(JSON.stringify({ error: rejectErr.message }), { status: 500 });
      }

      // BUG-20: reject_price also cancels the order, so the seller must hear
      // about it too — same fan-out as the plain cancel branch.
      try {
        const { notifyOrderParties } = await import("../../../lib/server/notify-order-parties");
        await notifyOrderParties({
          order_id,
          event: "cancelled_by_buyer",
          origin: url.origin,
          amount: Number(order.paid_amount) || null,
        });
      } catch (err) {
        console.warn("[cancel:reject_price] notify fan-out failed", { order_id, err: (err as any)?.message });
      }

      return new Response(JSON.stringify({ success: true, status: "cancelled" }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/**
 * Cancel one item the buyer owns. Claims the cancel FIRST, guarded on the status we
 * checked: it used to refund first and then write status unguarded, so a seller
 * marking the order Ready at the same moment ended with food prepared for a
 * refunded order. Stock comes back via trg_restore_inventory (BUG-38: no explicit
 * restore). A paid item gets every Razorpay payment back (upfront + any balance;
 * on a cart paid in one go, only this item's share); on failure the item stays
 * cancelled with a note and the daily cron retries.
 */
async function cancelRow(sb: any, order: any, reason: string | null) {
  const { data: seller } = order.listing_id
    ? await sb.from("fish_listings")
        .select("seller:sellers(opens_at, closes_at, accepts_preorder, open_days, preorder_days, preorder_cutoff_time, preorder_opens_at, delivery_days)")
        .eq("id", order.listing_id).maybeSingle().then((r: any) => ({ data: r.data?.seller ?? null }))
    : { data: null };
  const rule = buyerCancelRule(order, seller);
  if (!rule.ok) return { error: rule.reason as string, status: 400 };

  const { data: claimed, error: cancelErr } = await sb.from("orders")
    .update({ status: "cancelled", cancelled_by: "buyer", cancel_reason: reason })
    .eq("id", order.id).eq("status", order.status)
    .select("id");
  if (cancelErr) return { error: "Could not cancel the order. Please try again.", status: 500 };
  if (!claimed?.length) return { error: "This order was just updated. Refresh to see its status.", status: 409 };

  const paid = isRazorpayPaid(order);
  // Unpaid: the delivery fee must not leave the cart with this item.
  if (!paid) await moveFeeOffClosedRow(sb, order.id);
  let refundId: string | null = null;
  let refundNote: string | null = null;
  let refundAmt = Number(order.paid_amount) || (Number(order.total_price) + Number(order.delivery_fee || 0));
  if (paid) {
    const outcome = await refundOrderRazorpay(sb, order, { caller: "cancel" });
    refundId = outcome.refundId;
    refundNote = outcome.note;
    // A cart item gets back its own share (the delivery fee only with the last item).
    if (outcome.refundedRupees != null) refundAmt = outcome.refundedRupees;
    const refundFields: Record<string, unknown> = { refund_note: refundNote };
    if (outcome.ok) {
      refundFields.refund_amt = refundAmt;
      refundFields.refund_sent_at = new Date().toISOString();
    }
    const { error: rfErr } = await sb.from("orders").update(refundFields).eq("id", order.id);
    if (rfErr) console.error("[cancel] refund recorded on Razorpay but not on the order", { order_id: order.id, refund_id: refundId, err: rfErr.message });
  }
  return { id: order.id as string, paid, refundId, refundNote, refundAmt };
}
