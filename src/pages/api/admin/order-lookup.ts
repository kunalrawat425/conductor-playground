import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const RAZORPAY_KEY_ID = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = import.meta.env.RAZORPAY_KEY_SECRET || "";
const ADMIN_SECRET = import.meta.env.ADMIN_SECRET || "";

/**
 * GET /api/admin/order-lookup?id=<uuid>&razorpay_order_id=<rzp_id>&razorpay_payment_id=<pay_id>&refund_id=<rfnd>
 * Auth: Bearer $ADMIN_SECRET
 *
 * Returns joined view of an order row + relevant Razorpay side-state so ops
 * can diagnose payment issues without DB access.
 *
 * Any of the query params can be used as the primary key. If more than one is
 * given, `id` wins, then `razorpay_order_id`, then `razorpay_payment_id`.
 */
export const GET: APIRoute = async ({ url, request }) => {
  if (!ADMIN_SECRET) return new Response(JSON.stringify({ error: "ADMIN_SECRET not configured" }), { status: 503 });
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${ADMIN_SECRET}`) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const id = url.searchParams.get("id");
  const rzpOrder = url.searchParams.get("razorpay_order_id");
  const rzpPayment = url.searchParams.get("razorpay_payment_id");
  const refundId = url.searchParams.get("refund_id");

  if (!id && !rzpOrder && !rzpPayment && !refundId) {
    return new Response(JSON.stringify({ error: "one of id, razorpay_order_id, razorpay_payment_id, refund_id required" }), { status: 400 });
  }

  const sb = createClient(supabaseUrl, supabaseServiceKey);
  const rzpAuth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");

  // Look up our order row
  let orderQuery = sb.from("orders").select("*, listing:fish_listings(species, seller:sellers(id, name, phone))");
  let pk: string;
  if (id) { orderQuery = orderQuery.eq("id", id); pk = `id=${id}`; }
  else if (rzpOrder) { orderQuery = orderQuery.eq("razorpay_order_id", rzpOrder); pk = `razorpay_order_id=${rzpOrder}`; }
  else if (rzpPayment) { orderQuery = orderQuery.eq("razorpay_payment_id", rzpPayment); pk = `razorpay_payment_id=${rzpPayment}`; }
  else { pk = `refund_id=${refundId}`; }

  const { data: rows } = pk.startsWith("refund_id=") ? { data: [] as any[] } : await orderQuery.limit(5);

  // Razorpay side: pull matching payment(s) + refunds if we have a rzp id
  const rzp: any = { payment: null, refunds: null, refund: null };
  const targetRzpOrder = rzpOrder || (rows?.[0] as any)?.razorpay_order_id;
  const targetRzpPayment = rzpPayment || (rows?.[0] as any)?.razorpay_payment_id;
  if (targetRzpOrder) {
    try {
      const r = await fetch(`https://api.razorpay.com/v1/orders/${targetRzpOrder}/payments`, { headers: { Authorization: `Basic ${rzpAuth}` } });
      if (r.ok) rzp.payments = await r.json();
      else rzp.payments_err = `${r.status}`;
    } catch (e: any) { rzp.payments_err = e?.message; }
  }
  if (targetRzpPayment) {
    try {
      const r = await fetch(`https://api.razorpay.com/v1/payments/${targetRzpPayment}`, { headers: { Authorization: `Basic ${rzpAuth}` } });
      if (r.ok) rzp.payment = await r.json();
      else rzp.payment_err = `${r.status}`;
    } catch (e: any) { rzp.payment_err = e?.message; }
    try {
      const r = await fetch(`https://api.razorpay.com/v1/payments/${targetRzpPayment}/refunds`, { headers: { Authorization: `Basic ${rzpAuth}` } });
      if (r.ok) rzp.refunds = await r.json();
      else rzp.refunds_err = `${r.status}`;
    } catch (e: any) { rzp.refunds_err = e?.message; }
  }
  if (refundId) {
    try {
      const r = await fetch(`https://api.razorpay.com/v1/refunds/${refundId}`, { headers: { Authorization: `Basic ${rzpAuth}` } });
      if (r.ok) rzp.refund = await r.json();
      else rzp.refund_err = `${r.status}`;
    } catch (e: any) { rzp.refund_err = e?.message; }
  }

  return new Response(JSON.stringify({
    ok: true,
    pk_used: pk,
    orders_count: rows?.length ?? 0,
    orders: rows,
    razorpay: rzp,
  }, null, 2), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
};
