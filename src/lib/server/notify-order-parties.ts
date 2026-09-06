import { createClient } from "@supabase/supabase-js";
import { sendBuyerOrderPush } from "./buyer-push";
import { internalHeaders } from "./internal-auth";
import { sendTransactionalEmail as sendEmail } from "./send-email";
import { absoluteUrl } from "./site-origin";

/**
 * BUG-20 / BUG-21 fix.
 *
 * Every order-lifecycle event must reach BOTH parties on BOTH channels
 * (push + email). Before this helper each endpoint hand-rolled its own
 * fan-out, so two paths were badly incomplete:
 *
 *   - orders/cancel.ts       — notified nobody on the seller side
 *   - payments/razorpay-webhook.ts — buyer push only (no emails, no seller)
 *
 * The webhook gap mattered most: it is the recovery path that fires exactly
 * when the buyer's browser died mid-payment, so the seller was left blind on
 * the orders that most needed attention.
 *
 * All failures are logged (never silently swallowed — see BUG-24) and never
 * block the caller's response.
 */

const supabaseUrl = import.meta.env?.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env?.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

export type OrderEvent =
  | "payment_confirmed"
  | "cancelled_by_buyer"
  | "expired_unpaid"
  | "refunded";

export type NotifyResult = {
  buyer_push: string;
  buyer_email: string;
  seller_push: string;
  seller_email: string;
};

/** Copy per event, per audience. Exported for unit tests. */
export function copyFor(event: OrderEvent, species: string, orderIdShort: string, amount: number | null) {
  const fish = species || "fish";
  const amt = amount != null ? ` (₹${amount})` : "";
  switch (event) {
    case "payment_confirmed":
      return {
        buyerSubject: `Payment confirmed — your ${fish} order is set ✓`,
        buyerHeading: "Payment confirmed",
        buyerLine: `We received your payment${amt} for ${fish}. Order #${orderIdShort} is confirmed and the seller has been notified.`,
        sellerSubject: `Payment confirmed — ${fish} · #${orderIdShort}`,
        sellerHeading: "Payment confirmed",
        sellerLine: `Payment${amt} confirmed for ${fish} (order #${orderIdShort}). Please prepare this order.`,
      };
    case "cancelled_by_buyer":
      return {
        buyerSubject: `Order cancelled — ${fish} · #${orderIdShort}`,
        buyerHeading: "Order cancelled",
        buyerLine: `Your ${fish} order #${orderIdShort} was cancelled${amt ? ". Refund" + amt + " is being processed." : "."}`,
        sellerSubject: `Order CANCELLED by buyer — ${fish} · #${orderIdShort}`,
        sellerHeading: "Order cancelled by buyer",
        sellerLine: `The buyer cancelled their ${fish} order #${orderIdShort}${amt}. Do not prepare this order.`,
      };
    case "expired_unpaid":
      return {
        buyerSubject: `Order cancelled — payment not completed · ${fish}`,
        buyerHeading: "Order cancelled",
        buyerLine: `Your ${fish} order #${orderIdShort} was cancelled because payment was not completed in time. Nothing has been charged. You can order again any time.`,
        sellerSubject: `Order expired unpaid — ${fish} · #${orderIdShort}`,
        sellerHeading: "Order expired unpaid",
        sellerLine: `The buyer never completed payment for ${fish} order #${orderIdShort}, so it was cancelled automatically. Do not prepare this order. Stock has been released.`,
      };
    case "refunded":
      return {
        buyerSubject: `Refund processed — ${fish} · #${orderIdShort}`,
        buyerHeading: "Refund processed",
        buyerLine: `A refund${amt} was processed for your ${fish} order #${orderIdShort}. It should reach your account in 5–7 working days.`,
        sellerSubject: `Refund processed — ${fish} · #${orderIdShort}`,
        sellerHeading: "Refund processed",
        sellerLine: `A refund${amt} was processed for ${fish} order #${orderIdShort}.`,
      };
  }
}

function shell(heading: string, line: string, orderId: string, cta: string): string {
  const url = absoluteUrl(`/track/${orderId}`);
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
  <h1 style="font-size:22px;margin:0 0 12px;color:#0F172A;">${heading}</h1>
  <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 20px;">${line}</p>
  <a href="${url}" style="display:inline-block;background:#0066cc;color:#fff;padding:12px 26px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;">${cta}</a>
  <p style="font-size:12px;color:#94A3B8;margin:24px 0 0;line-height:1.5;">Relifish · Mumbai<br/>Questions? relifishstore@gmail.com</p>
</div>`;
}

/** Buyer push status string for each event (maps into buyer-order-push-copy). Exported for unit tests. */
export function pushStatusFor(event: OrderEvent): string {
  if (event === "payment_confirmed") return "confirmed";
  if (event === "cancelled_by_buyer") return "cancelled";
  if (event === "expired_unpaid") return "expired_unpaid";
  return "refunded";
}

/** Seller push kind for each event (maps into seller-push-copy). Exported for unit tests. */
export function sellerPushKindFor(event: OrderEvent): "payment_confirmed" | "cancelled" | "expired_unpaid" | "refunded" {
  if (event === "payment_confirmed") return "payment_confirmed";
  if (event === "cancelled_by_buyer") return "cancelled";
  if (event === "expired_unpaid") return "expired_unpaid";
  return "refunded";
}

/**
 * Fan out one order event to buyer + seller across push and email.
 * Never throws. Returns per-channel outcomes so callers can log them.
 */
export async function notifyOrderParties(opts: {
  order_id: string;
  event: OrderEvent;
  /** Absolute origin for the internal notify-seller self-call. */
  origin: string;
  amount?: number | null;
}): Promise<NotifyResult> {
  const { order_id, event, origin, amount = null } = opts;
  const out: NotifyResult = {
    buyer_push: "not attempted",
    buyer_email: "not attempted",
    seller_push: "not attempted",
    seller_email: "not attempted",
  };

  const sb = createClient(supabaseUrl, supabaseServiceKey);

  const { data: order, error } = await sb
    .from("orders")
    .select("id, buyer_id, buyer_phone, species, quantity, quantity_unit, total_price, delivery_fee, listing:fish_listings(species, seller_id, seller:sellers(id, name, email))")
    .eq("id", order_id)
    .single();

  if (error || !order) {
    console.warn(`[notify] order ${order_id} not found:`, error?.message);
    return out;
  }

  const o: any = order;
  const species = String(o.listing?.species || o.species || "fish");
  const orderIdShort = String(order_id).slice(0, 8).toUpperCase();
  const amt = amount ?? ((Number(o.total_price || 0) + Number(o.delivery_fee || 0)) || null);
  const c = copyFor(event, species, orderIdShort, amt);

  // ---- Buyer push ----
  try {
    const r = await sendBuyerOrderPush({
      buyer_id: o.buyer_id,
      buyer_phone: o.buyer_phone,
      status: pushStatusFor(event),
      species,
      order_id,
    });
    out.buyer_push = r.ok ? (("sent" in r && r.sent) ? "sent" : `skipped: ${(r as any).reason}`) : `failed: ${(r as any).error}`;
  } catch (err: any) {
    out.buyer_push = `failed: ${err?.message}`;
    console.warn("[notify] buyer push threw", err?.message);
  }

  // ---- Buyer email ----
  if (o.buyer_id) {
    try {
      const { data: buyer } = await sb.from("buyers").select("email").eq("id", o.buyer_id).single();
      out.buyer_email = buyer?.email
        ? await sendEmail(buyer.email, c.buyerSubject, shell(c.buyerHeading, c.buyerLine, order_id, "View order"), "buyer")
        : "skipped: buyer has no email";
    } catch (err: any) {
      out.buyer_email = `failed: ${err?.message}`;
      console.warn("[notify] buyer email lookup threw", err?.message);
    }
  } else {
    out.buyer_email = "skipped: guest order (no buyer_id)";
  }

  // ---- Seller email + push ----
  const sellerId = o.listing?.seller_id || o.listing?.seller?.id;
  const sellerEmail = o.listing?.seller?.email;

  out.seller_email = sellerEmail
    ? await sendEmail(sellerEmail, c.sellerSubject, shell(c.sellerHeading, c.sellerLine, order_id, "Open dashboard"), "seller")
    : "skipped: seller has no email";

  if (sellerId) {
    try {
      const res = await fetch(`${origin}/api/notify-seller`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...internalHeaders() },
        body: JSON.stringify({
          // BUG-26: this used to send "payment_proof" for cancellations and
          // refunds, so the seller's push said "Verify in dashboard" about an
          // order the buyer had just cancelled.
          kind: sellerPushKindFor(event),
          seller_id: sellerId,
          species,
          quantity: o.quantity,
          quantity_unit: o.quantity_unit,
          order_id,
          order_id_short: orderIdShort,
          amount: amt,
        }),
      });
      // BUG-28: notify-seller answers 200 for "skipped" outcomes too (no
      // subscription, VAPID unset, dead endpoint). Trusting the status code
      // alone made the log claim the seller was notified when nothing was sent.
      if (!res.ok) {
        out.seller_push = `failed: notify-seller ${res.status}`;
        console.warn(`[notify] notify-seller ${res.status} for ${order_id}`);
      } else {
        const j: any = await res.json().catch(() => ({}));
        out.seller_push = j?.sent === true ? "sent" : `skipped: ${j?.reason || "notify-seller reported no send"}`;
      }
    } catch (err: any) {
      out.seller_push = `failed: ${err?.message}`;
      console.warn("[notify] notify-seller threw", err?.message);
    }
  } else {
    out.seller_push = "skipped: no seller_id on listing";
  }

  console.log(`[notify] ${event} ${orderIdShort}`, JSON.stringify(out));
  return out;
}
