import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { sendBuyerOrderPush } from "../../../lib/server/buyer-push";
import { isRazorpayPaid } from "../../../lib/server/razorpay-refund";
import { refundOrderRazorpay } from "../../../lib/server/razorpay-ledger";
import { buyerCancelRule } from "../../../lib/order-cancel";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

export const POST: APIRoute = async ({ request, url }) => {
  try {
    const { order_id, buyer_id, action, cancel_reason } = await request.json();
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
      const { data: seller } = order.listing_id
        ? await sb.from("fish_listings")
            .select("seller:sellers(opens_at, closes_at, accepts_preorder, open_days, preorder_days, preorder_cutoff_time)")
            .eq("id", order.listing_id).maybeSingle().then((r: any) => ({ data: r.data?.seller ?? null }))
        : { data: null };
      const rule = buyerCancelRule(order, seller);
      if (!rule.ok) {
        return new Response(JSON.stringify({ error: rule.reason }), { status: 400 });
      }

      // Claim the cancel FIRST, guarded on the status we checked. It used to
      // refund first and then write status unguarded: a seller marking the order
      // Ready at the same moment ended with food prepared for a refunded order.
      // Stock comes back via trg_restore_inventory (BUG-38: no explicit restore).
      const { data: claimed, error: cancelErr } = await sb.from("orders")
        .update({ status: "cancelled", cancelled_by: "buyer", cancel_reason: cancel_reason || null })
        .eq("id", order_id).eq("status", order.status)
        .select("id");
      if (cancelErr) {
        return new Response(JSON.stringify({ error: "Could not cancel the order. Please try again." }), { status: 500 });
      }
      if (!claimed?.length) {
        return new Response(JSON.stringify({ error: "The seller just updated this order. Refresh to see its status." }), { status: 409 });
      }

      // Full refund of every Razorpay payment (upfront + any balance). On failure
      // the order stays cancelled with a note and the daily cron retries.
      let refundNote: string | null = null;
      let refundId: string | null = null;
      const isRzpPaid = isRazorpayPaid(order);
      if (isRzpPaid) {
        const outcome = await refundOrderRazorpay(sb, order, { caller: "cancel" });
        refundId = outcome.refundId;
        refundNote = outcome.note;
        const refundFields: Record<string, unknown> = { refund_note: refundNote };
        if (outcome.ok) {
          refundFields.refund_amt = Number(order.paid_amount) || (Number(order.total_price) + Number(order.delivery_fee || 0));
          refundFields.refund_sent_at = new Date().toISOString();
        }
        const { error: rfErr } = await sb.from("orders").update(refundFields).eq("id", order_id);
        if (rfErr) console.error("[cancel] refund recorded on Razorpay but not on the order", { order_id, refund_id: refundId, err: rfErr.message });
      }

      // BUG-20 + BUG-25: previously only the buyer got a push here — the seller
      // was told NOTHING, so they could prep an order cancelled hours earlier.
      // Now both parties get push + email.
      let notified: unknown = null;
      try {
        const { notifyOrderParties } = await import("../../../lib/server/notify-order-parties");
        notified = await notifyOrderParties({
          order_id,
          event: "cancelled_by_buyer",
          origin: url.origin,
          amount: isRzpPaid ? (Number(order.paid_amount) || null) : null,
        });
      } catch (err) {
        console.warn("[cancel] notify fan-out failed", { order_id, err: (err as any)?.message });
      }

      return new Response(JSON.stringify({
        success: true,
        status: "cancelled",
        refund: isRzpPaid ? { auto: !!refundId, id: refundId, note: refundNote } : null,
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
