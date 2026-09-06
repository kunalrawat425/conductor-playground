import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const RAZORPAY_KEY_ID = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = import.meta.env.RAZORPAY_KEY_SECRET || "";

export const POST: APIRoute = async ({ request, url }) => {
  if (import.meta.env.PUBLIC_ENABLE_RAZORPAY !== "true") {
    return new Response(JSON.stringify({ error: "Razorpay is not enabled" }), { status: 400 });
  }
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return new Response(JSON.stringify({ error: "Payment gateway not configured" }), { status: 503 });
  }

  let body: { order_id?: string; buyer_id?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 });
  }

  const { order_id, buyer_id } = body;
  if (!order_id || !buyer_id) {
    return new Response(JSON.stringify({ error: "order_id and buyer_id required" }), { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Fetch order — verify ownership and status
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, buyer_id, total_price, delivery_fee, status, razorpay_order_id")
    .eq("id", order_id)
    .single();

  if (orderErr || !order) {
    return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
  }
  if (order.buyer_id !== buyer_id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
  }
  if (!["pending", "pending_payment"].includes(order.status)) {
    return new Response(
      JSON.stringify({ error: `Order status '${order.status}' cannot be paid via Razorpay` }),
      { status: 400 }
    );
  }

  // Idempotency — reuse existing Razorpay order ONLY if amount still matches.
  // If seller changed `final_price` between two Pay clicks, the cached
  // Razorpay order carries the OLD amount → buyer pays stale amount → verify.ts:66
  // rejects with "Payment does not match this order". Prevent that by
  // dropping the stale reference and creating a fresh Razorpay order.
  const amountPaise = Math.round(
    (Number(order.total_price) + Number(order.delivery_fee || 0)) * 100
  );
  if (order.razorpay_order_id) {
    // Ask Razorpay for the cached order's amount
    const authHex = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
    let cachedOk = false;
    let cachedAmountPaid = 0;
    let cachedFetched = false;
    try {
      const cachedRes = await fetch(`https://api.razorpay.com/v1/orders/${order.razorpay_order_id}`, {
        headers: { Authorization: `Basic ${authHex}` },
      });
      if (cachedRes.ok) {
        const cachedOrder = await cachedRes.json();
        cachedFetched = true;
        cachedOk = Number(cachedOrder?.amount) === amountPaise;
        cachedAmountPaid = Number(cachedOrder?.amount_paid) || 0;
      }
    } catch { /* network or malformed — cachedOk stays false, fall through to create new */ }

    if (cachedOk) {
      return new Response(
        JSON.stringify({
          razorpay_order_id: order.razorpay_order_id,
          amount: amountPaise,
          currency: "INR",
          key_id: RAZORPAY_KEY_ID,
        }),
        { status: 200 }
      );
    }
    // BUG-41: this used to clear `razorpay_order_id` unconditionally whenever
    // the amount drifted. That column is the ONLY key every recovery path uses:
    //   - razorpay-webhook matches .eq("razorpay_order_id", ...)
    //   - cron/reconcile-orphans filters .not("razorpay_order_id","is",null)
    //   - seller/reconcile-razorpay reads the stored id
    // So if the buyer had already paid the cached order and the client-side
    // verify never landed, nulling it orphaned real money: the webhook matched
    // zero rows, the cron could not see the row, and 24h later
    // expire-pending-orders (.is("razorpay_order_id", null)) cancelled it as
    // "auto_expired_payment". Captured payment, cancelled order, no refund.
    //
    // Never discard an id that already has money against it — reconcile instead.
    if (cachedAmountPaid > 0) {
      let capturedId: string | null = null;
      let capturedPaise = cachedAmountPaid;
      try {
        const payRes = await fetch(`https://api.razorpay.com/v1/orders/${order.razorpay_order_id}/payments`, {
          headers: { Authorization: `Basic ${authHex}` },
        });
        if (payRes.ok) {
          const payBody = await payRes.json();
          const captured = Array.isArray(payBody?.items)
            ? payBody.items.find((pmt: any) => pmt?.status === "captured")
            : null;
          if (captured) {
            capturedId = String(captured.id);
            capturedPaise = Number(captured.amount) || cachedAmountPaid;
          }
        }
      } catch (err: any) {
        console.warn("[razorpay-create-order] could not list payments for paid order", {
          order_id, razorpay_order_id: order.razorpay_order_id, err: err?.message,
        });
      }

      if (capturedId) {
        const { error: recErr } = await supabase
          .from("orders")
          .update({
            status: "confirmed",
            payment_method: "razorpay",
            razorpay_payment_id: capturedId,
            paid_amount: capturedPaise / 100,
            payment_verified_at: new Date().toISOString(),
            payment_verified_by: null,
          })
          .eq("id", order_id)
          .in("status", ["pending", "pending_payment"]);
        if (recErr) {
          console.error("[razorpay-create-order] reconcile of already-paid order failed", { order_id, err: recErr.message });
        } else {
          console.log(`[razorpay-create-order] order ${order_id} was already paid (${capturedId}) — reconciled instead of re-charging`);
          const { notifyOrderParties } = await import("../../../lib/server/notify-order-parties");
          await notifyOrderParties({ order_id, event: "payment_confirmed", origin: url.origin, amount: capturedPaise / 100 })
            .catch((err: any) => console.warn("[razorpay-create-order] notify failed", { order_id, err: err?.message }));
        }
      }

      // Either way, do not open a second checkout against an order that has
      // already been paid — that is how buyers get charged twice.
      return new Response(
        JSON.stringify({
          error: "This order has already been paid. Refresh to see the updated status.",
          error_code: "already_paid",
          razorpay_payment_id: capturedId,
        }),
        { status: 409 }
      );
    }

    // Only safe to clear once we know Razorpay holds no money for it. If we
    // could not reach Razorpay at all, keep the id rather than risk orphaning.
    if (!cachedFetched) {
      console.warn("[razorpay-create-order] could not verify cached order — keeping razorpay_order_id", {
        order_id, razorpay_order_id: order.razorpay_order_id,
      });
      return new Response(
        JSON.stringify({ error: "Could not reach the payment gateway. Please try again." }),
        { status: 502 }
      );
    }

    // Amount drifted and Razorpay holds nothing — safe to replace.
    await supabase.from("orders").update({ razorpay_order_id: null }).eq("id", order_id);
  }

  if (amountPaise <= 0) {
    return new Response(JSON.stringify({ error: "Order amount is zero" }), { status: 400 });
  }

  // Create Razorpay order via their API
  const credentials = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  let rzpResponse: Response;
  try {
    rzpResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt: order_id.slice(0, 40), // Razorpay receipt max 40 chars
      }),
    });
  } catch {
    return new Response(JSON.stringify({ error: "Could not reach payment gateway" }), { status: 502 });
  }

  if (!rzpResponse.ok) {
    const errBody = await rzpResponse.json().catch(() => ({}));
    const msg = (errBody as any)?.error?.description || "Payment gateway error";
    return new Response(JSON.stringify({ error: msg }), { status: 502 });
  }

  const rzpOrder = await rzpResponse.json();
  const razorpay_order_id: string = rzpOrder.id;

  // Store Razorpay order ID on our order row
  const { error: updateErr } = await supabase
    .from("orders")
    .update({ razorpay_order_id })
    .eq("id", order_id);

  if (updateErr) {
    return new Response(JSON.stringify({ error: "Failed to save payment reference" }), { status: 500 });
  }

  return new Response(
    JSON.stringify({
      razorpay_order_id,
      amount: amountPaise,
      currency: "INR",
      key_id: RAZORPAY_KEY_ID,
    }),
    { status: 200 }
  );
};
