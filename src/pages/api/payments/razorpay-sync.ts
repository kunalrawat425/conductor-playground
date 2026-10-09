import type { APIRoute } from "astro";
import { requireBuyer } from "../../../lib/server/session";
import { createClient } from "@supabase/supabase-js";
import { settleCapturedPayment, PAYABLE_STATUSES } from "../../../lib/server/razorpay-ledger";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const KEY_ID = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
const KEY_SECRET = import.meta.env.RAZORPAY_KEY_SECRET || "";

/**
 * POST /api/payments/razorpay-sync   { order_id, buyer_id }
 *
 * "Did my payment go through?" — asked by the order page when the Razorpay
 * checkout closes, or when it loads an order still awaiting payment. Razorpay's
 * in-page handler does not fire when the modal is closed, a UPI app takes over,
 * or the tab is switched; on staging a captured payment stayed unpaid until the
 * buyer pressed Pay again. Captured payments are settled with the same rules as
 * verify / webhook / cron.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }
  const { order_id, buyer_id } = body || {};
  { const denied = requireBuyer(request, buyer_id); if (denied) return denied; }
  if (!order_id || !buyer_id) return new Response(JSON.stringify({ error: "order_id and buyer_id required" }), { status: 400 });

  const sb = createClient(supabaseUrl, supabaseServiceKey);
  const { data: order } = await sb.from("orders").select("id, buyer_id, status, razorpay_order_id").eq("id", order_id).maybeSingle();
  if (!order || order.buyer_id !== buyer_id) return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
  if (!order.razorpay_order_id || !PAYABLE_STATUSES.includes(order.status) || !KEY_ID || !KEY_SECRET) {
    return new Response(JSON.stringify({ status: order.status, changed: false }), { status: 200 });
  }

  let items: any[] = [];
  try {
    const res = await fetch(`https://api.razorpay.com/v1/orders/${order.razorpay_order_id}/payments`, {
      headers: { Authorization: `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}` },
    });
    if (res.ok) items = (await res.json())?.items ?? [];
  } catch { /* Razorpay unreachable: nothing changes, the webhook / cron still recover it */ }

  let status = order.status;
  for (const p of items.filter((x) => x?.status === "captured")) {
    try {
      const r = await settleCapturedPayment(sb, { razorpay_order_id: order.razorpay_order_id, razorpay_payment_id: p.id, source: "sync" });
      if (r.kind !== "orphan") status = r.order.status;
    } catch (err: any) {
      console.error("[razorpay-sync] settle failed", { order_id, payment: p.id, err: err?.message });
    }
  }
  return new Response(JSON.stringify({ status, changed: status !== order.status }), { status: 200 });
};
