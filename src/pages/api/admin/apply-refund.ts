import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const RAZORPAY_KEY_ID = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = import.meta.env.RAZORPAY_KEY_SECRET || "";
const ADMIN_SECRET = import.meta.env.ADMIN_SECRET || "";

/**
 * POST /api/admin/apply-refund
 * Auth: Authorization: Bearer $ADMIN_SECRET
 * Body: { refund_id: "rfnd_..." }  OR  { order_id: "<uuid>", payment_id, refund_id, amount }
 *
 * Escape hatch for refunds issued at Razorpay BEFORE the refund webhook was
 * live. Given a refund_id, fetch the refund from Razorpay to get its
 * payment_id + amount, then locate our order row by razorpay_payment_id
 * (or by explicit order_id if provided) and mark refunded.
 *
 * Idempotent — safe to run repeatedly.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!ADMIN_SECRET) return new Response(JSON.stringify({ error: "ADMIN_SECRET not configured" }), { status: 503 });
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${ADMIN_SECRET}`) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  let body: { refund_id?: string; order_id?: string; payment_id?: string; amount?: number };
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }

  const sb = createClient(supabaseUrl, supabaseServiceKey);
  const rzpAuth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");

  let refund_id = body.refund_id;
  let payment_id = body.payment_id;
  let amount_paise = body.amount;

  // If only refund_id provided, look it up at Razorpay to get payment_id + amount
  if (refund_id && (!payment_id || !amount_paise)) {
    let res: Response;
    try {
      res = await fetch(`https://api.razorpay.com/v1/refunds/${refund_id}`, {
        headers: { Authorization: `Basic ${rzpAuth}` },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: `Razorpay unreachable: ${err?.message}` }), { status: 502 });
    }
    if (!res.ok) {
      const rb = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: `Razorpay ${res.status}: ${(rb as any)?.error?.description || "not found"}` }), { status: res.status });
    }
    const rfnd = await res.json();
    payment_id = payment_id || rfnd.payment_id;
    amount_paise = amount_paise ?? Number(rfnd.amount);
  }

  if (!payment_id) return new Response(JSON.stringify({ error: "payment_id required (or refund_id lookup failed)" }), { status: 400 });

  // Locate order — either by explicit order_id or by razorpay_payment_id
  const orderQuery = body.order_id
    ? sb.from("orders").select("id, status").eq("id", body.order_id)
    : sb.from("orders").select("id, status").eq("razorpay_payment_id", payment_id);
  const { data: rows } = await orderQuery;

  if (!rows || rows.length === 0) {
    return new Response(JSON.stringify({
      ok: false,
      reason: "No matching order for that payment_id. Provide order_id explicitly if the row lacks razorpay_payment_id.",
      hint: "If original payment happened pre-webhook, its razorpay_payment_id column is null. Pass { order_id, refund_id }.",
    }), { status: 404 });
  }

  const orderId = (rows[0] as any).id;
  const refundAmtRupees = (amount_paise ?? 0) / 100;

  const { data: upd, error: uErr } = await sb
    .from("orders")
    .update({
      status: "refunded",
      payment_method: "razorpay",
      razorpay_payment_id: payment_id,
      refund_note: `Admin-applied Razorpay refund ${refund_id || "(unspecified)"}`,
      refund_amt: refundAmtRupees,
      refund_sent_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select("id, status, refund_amt, refund_sent_at");

  if (uErr) return new Response(JSON.stringify({ error: `db: ${uErr.message}` }), { status: 500 });

  return new Response(JSON.stringify({ ok: true, updated: upd?.[0], refund_id, payment_id, amount_rupees: refundAmtRupees }, null, 2), { status: 200 });
};
