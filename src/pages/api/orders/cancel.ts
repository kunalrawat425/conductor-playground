import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { sendBuyerOrderPush } from "../../../lib/server/buyer-push";

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
      const preFulfillmentStates = ["pending", "pending_payment", "pre_order", "scheduled"];
      const confirmedCancellable = order.status === "confirmed";
      if (!preFulfillmentStates.includes(order.status) && !confirmedCancellable) {
        return new Response(JSON.stringify({ error: "Cannot cancel — order is already " + order.status }), { status: 400 });
      }

      // Restore stock only if inventory was deducted (029: pending_payment skips deduct until confirm)
      if (order.listing_id && order.inventory_deducted === true) {
        await sb.rpc("restore_order_stock", { p_listing_id: order.listing_id, p_quantity: order.quantity });
      }

      // Trigger Razorpay refund if the order was paid via Razorpay.
      // Non-blocking: on failure we still cancel the order and flag it for manual seller refund.
      let refundNote: string | null = null;
      let refundId: string | null = null;
      const isRzpPaid = order.payment_method === "razorpay" && order.razorpay_payment_id;
      if (isRzpPaid) {
        const keyId = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
        const keySecret = import.meta.env.RAZORPAY_KEY_SECRET || "";
        if (keyId && keySecret) {
          const authHex = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
          try {
            const rr = await fetch(`https://api.razorpay.com/v1/payments/${order.razorpay_payment_id}/refund`, {
              method: "POST",
              headers: { Authorization: `Basic ${authHex}`, "Content-Type": "application/json" },
              body: JSON.stringify({ speed: "normal" }),
            });
            if (rr.ok) {
              const body = await rr.json();
              refundId = body?.id || null;
              refundNote = `Razorpay refund ${refundId} initiated`;
            } else {
              const body = await rr.json().catch(() => ({}));
              refundNote = `Razorpay refund FAILED (${rr.status}): ${(body as any)?.error?.description || "unknown"} — seller must refund manually`;
              console.warn("[cancel] razorpay refund failed", { order_id, status: rr.status, body });
            }
          } catch (err: any) {
            refundNote = `Razorpay refund FAILED (network): ${err?.message || "unknown"} — seller must refund manually`;
            console.warn("[cancel] razorpay refund network err", { order_id, err: err?.message });
          }
        } else {
          refundNote = "Razorpay keys not configured — seller must refund manually";
        }
      }

      const updatePayload: Record<string, unknown> = {
        status: "cancelled",
        cancelled_by: "buyer",
        cancel_reason: cancel_reason || null,
      };
      if (refundNote) updatePayload.refund_note = refundNote;
      if (isRzpPaid && refundId) {
        updatePayload.refund_amt = Number(order.paid_amount) || (Number(order.total_price) + Number(order.delivery_fee || 0));
        updatePayload.refund_sent_at = new Date().toISOString();
      }
      await sb.from("orders").update(updatePayload).eq("id", order_id);

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
      await sb.from("orders").update({
        status: "confirmed",
        payment_verified_at: order.payment_verified_at || new Date().toISOString(),
        payment_verified_by: order.payment_verified_by || "buyer_accept_price",
      }).eq("id", order_id);

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

      if (order.listing_id && order.inventory_deducted === true) {
        await sb.rpc("restore_order_stock", { p_listing_id: order.listing_id, p_quantity: order.quantity });
      }

      await sb.from("orders").update({ status: "cancelled", refund_amt: order.paid_amount, cancelled_by: "buyer", cancel_reason: "Price rejected by buyer" }).eq("id", order_id);

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
