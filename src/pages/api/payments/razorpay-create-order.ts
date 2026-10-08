import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const RAZORPAY_KEY_ID = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = import.meta.env.RAZORPAY_KEY_SECRET || "";

export const POST: APIRoute = async ({ request, url }) => {
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
    .select("id, buyer_id, total_price, delivery_fee, status, razorpay_order_id, razorpay_payment_id, final_price, paid_amount")
    .eq("id", order_id)
    .single();

  if (orderErr || !order) {
    return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
  }
  if (order.buyer_id !== buyer_id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
  }
  // BUG-47: `payment_required` means the seller's final price came in ABOVE what
  // the buyer already paid, so a balance is owed. It was excluded here, which
  // left the buyer with no Razorpay button at all — and the UPI fallback shows
  // no UPI id, because detail.ts strips it whenever Razorpay is enabled. The
  // order was simply unpayable.
  if (!["pending", "pending_payment", "payment_required"].includes(order.status)) {
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
  // A balance payment must charge only the DIFFERENCE. Charging
  // total_price + delivery_fee again would take the full amount a second time.
  const isBalanceDue = order.status === "payment_required";
  const amountPaise = isBalanceDue
    ? Math.round(Math.max(0, Number(order.final_price || 0) - Number(order.paid_amount || 0)) * 100)
    : Math.round((Number(order.total_price) + Number(order.delivery_fee || 0)) * 100);
  if (order.razorpay_order_id) {
    // Ask Razorpay for the cached order's amount
    const authHex = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
    let cachedOk = false;
    let cachedAmountPaid = 0;
    // Did Razorpay give us a definitive answer about this order id?
    //
    // BUG-49: this used to be a single `cachedFetched` flag set only on a 2xx,
    // and anything else returned 502. But Razorpay answers **400
    // BAD_REQUEST_ERROR** ("The id provided does not exist") for an unknown or
    // foreign order id — a definitive "no such order", not an outage. So any
    // row carrying a stale id (keys rotated, id from another account, a value
    // written by hand) became permanently unpayable: every Pay click returned
    // 502 "Could not reach the payment gateway" and no fresh Razorpay order was
    // ever created. Staging accumulates exactly those rows.
    //
    // Split the two cases. A 4xx means Razorpay definitively holds nothing for
    // this id, so clearing it cannot orphan money — which is all BUG-41 was
    // protecting against. Only a throw or a 5xx is genuine unreachability.
    let answered = false;      // Razorpay responded about this id, 2xx or 4xx
    let unreachable = false;   // network error or 5xx — no answer at all
    try {
      const cachedRes = await fetch(`https://api.razorpay.com/v1/orders/${order.razorpay_order_id}`, {
        headers: { Authorization: `Basic ${authHex}` },
      });
      if (cachedRes.ok) {
        const cachedOrder = await cachedRes.json();
        answered = true;
        cachedOk = Number(cachedOrder?.amount) === amountPaise;
        cachedAmountPaid = Number(cachedOrder?.amount_paid) || 0;
      } else if (cachedRes.status === 400 || cachedRes.status === 404) {
        // Definitive: no such order under these keys, so no money against it.
        // Only 400/404. A 401 (keys rotated/misconfigured) or 429 (rate limit)
        // says nothing about the order — treating those as "gone" cleared ids
        // that had captured money against them (BUG-41 again).
        answered = true;
        console.warn("[razorpay-create-order] stale razorpay_order_id — Razorpay does not recognise it, replacing", {
          order_id, razorpay_order_id: order.razorpay_order_id, status: cachedRes.status,
        });
      } else {
        unreachable = true;
        console.warn("[razorpay-create-order] Razorpay 5xx while checking cached order", {
          order_id, razorpay_order_id: order.razorpay_order_id, status: cachedRes.status,
        });
      }
    } catch (err: any) {
      unreachable = true;
      console.warn("[razorpay-create-order] network error while checking cached order", {
        order_id, razorpay_order_id: order.razorpay_order_id, err: err?.message,
      });
    }

    // Reuse only an UNPAID cached order: Razorpay will not take a second payment
    // on a paid one, and a balance top-up's cached id is the paid upfront order.
    if (cachedOk && cachedAmountPaid === 0) {
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
      let capturedIds: string[] = [];
      try {
        const payRes = await fetch(`https://api.razorpay.com/v1/orders/${order.razorpay_order_id}/payments`, {
          headers: { Authorization: `Basic ${authHex}` },
        });
        if (payRes.ok) {
          const payBody = await payRes.json();
          capturedIds = Array.isArray(payBody?.items)
            ? payBody.items.filter((pmt: any) => pmt?.status === "captured").map((pmt: any) => String(pmt.id))
            : [];
        }
      } catch (err: any) {
        console.warn("[razorpay-create-order] could not list payments for paid order", {
          order_id, razorpay_order_id: order.razorpay_order_id, err: err?.message,
        });
      }

      // Balance top-up: the cached id is the upfront order whose payment is
      // already on the row. It is spent, not "already paid for this amount" —
      // fall through and open a fresh Razorpay order for the difference.
      // Without this every balance Pay click returned 409 and the order was unpayable.
      const spentUpfront = isBalanceDue && !!order.razorpay_payment_id && capturedIds.includes(order.razorpay_payment_id);
      if (!spentUpfront) {
        // Never discard an id that already has money against it — settle it with
        // the same rules verify/webhook/cron use (confirm, attach, or refund).
        const { settleCapturedPayment } = await import("../../../lib/server/razorpay-ledger");
        for (const capturedId of capturedIds) {
          try {
            const r = await settleCapturedPayment(supabase, {
              razorpay_order_id: order.razorpay_order_id, razorpay_payment_id: capturedId, source: "create_order",
            });
            if (r.kind === "confirmed") {
              console.log(`[razorpay-create-order] order ${order_id} was already paid (${capturedId}) — reconciled instead of re-charging`);
              const { notifyOrderParties } = await import("../../../lib/server/notify-order-parties");
              await notifyOrderParties({ order_id, event: "payment_confirmed", origin: url.origin })
                .catch((err: any) => console.warn("[razorpay-create-order] notify failed", { order_id, err: err?.message }));
            }
          } catch (err: any) {
            console.error("[razorpay-create-order] reconcile of already-paid order failed", { order_id, err: err?.message });
          }
        }

        // Either way, do not open a second checkout against an order that has
        // already been paid — that is how buyers get charged twice.
        return new Response(
          JSON.stringify({
            error: "This order has already been paid. Refresh to see the updated status.",
            error_code: "already_paid",
            razorpay_payment_id: capturedIds[0] ?? null,
          }),
          { status: 409 }
        );
      }
    }

    // Genuinely no answer from Razorpay — keep the id rather than risk
    // orphaning a payment we cannot see (BUG-41). A 4xx does NOT land here.
    if (unreachable || !answered) {
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
