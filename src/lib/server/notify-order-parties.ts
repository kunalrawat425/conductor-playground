import { buyerEmailCopy, withPreview, type BuyerEmailKind } from "../email-subjects";
import { createClient } from "@supabase/supabase-js";
import { cancelReasonText, isLateCancel } from "../order-cancel";
import { sendBuyerOrderPush } from "./buyer-push";
import { internalHeaders } from "./internal-auth";
import { sendTransactionalEmail as sendEmail } from "./send-email";
import { absoluteUrl } from "./site-origin";
import { SUPPORT_EMAIL, whatsappLink } from "../brand";
import { cartLabel, isLiveRow } from "./order-cart";

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
  | "cancelled_by_seller"
  | "expired_unpaid"
  | "refunded";

export type NotifyResult = {
  buyer_push: string;
  buyer_email: string;
  seller_push: string;
  seller_email: string;
};

const BUYER_KIND: Record<OrderEvent, BuyerEmailKind> = {
  payment_confirmed: "placed", cancelled_by_buyer: "buyer_cancelled", cancelled_by_seller: "seller_cancelled",
  expired_unpaid: "expired_unpaid", refunded: "refunded",
};

/** Copy per event, per audience; buyerSubject/buyerPreview follow email-subjects (founder, 26 Oct). Exported for unit tests. */
export function copyFor(event: OrderEvent, species: string, orderIdShort: string, amount: number | null, reason: string | null = null, ctx: { seller?: string | null; eveningPreorder?: boolean } = {}) {
  const b = buyerEmailCopy(BUYER_KIND[event], { fish: species ? species.charAt(0).toUpperCase() + species.slice(1) : "fish", seller: ctx.seller, amount, eveningPreorder: ctx.eveningPreorder });
  return { ...copyLines(event, species, orderIdShort, amount, reason), buyerSubject: b.subject, buyerPreview: b.preview };
}

function copyLines(event: OrderEvent, species: string, orderIdShort: string, amount: number | null, reason: string | null) {
  const fish = species || "fish";
  const amt = amount != null ? ` (₹${amount})` : "";
  const why = reason ? ` Reason: ${reason}.` : "";
  switch (event) {
    case "payment_confirmed":
      return {
        buyerSubject: `Payment received — ${fish} · #${orderIdShort}`,
        buyerHeading: "Payment received",
        buyerLine: `We received your payment${amt} for ${fish} (order #${orderIdShort}). Your order will be confirmed shortly.`,
        sellerSubject: `New paid order — please confirm · ${fish} · #${orderIdShort}`,
        sellerHeading: "New paid order — confirm it",
        sellerLine: `The buyer paid${amt} for ${fish} (order #${orderIdShort}). Open your dashboard to confirm or decline it.`,
      };
    case "cancelled_by_buyer":
      return {
        buyerSubject: `You cancelled your order — ${fish} · #${orderIdShort}`,
        buyerHeading: "You cancelled your order",
        buyerLine: `Your ${fish} order #${orderIdShort} is cancelled.${why}${amt ? " Refund" + amt + " is being processed." : ""}`,
        sellerSubject: `Order CANCELLED by the buyer — ${fish} · #${orderIdShort}`,
        sellerHeading: "Order cancelled by the buyer",
        sellerLine: `The buyer cancelled their ${fish} order #${orderIdShort}${amt}.${why} Do not prepare this order.`,
      };
    case "cancelled_by_seller":
      return {
        buyerSubject: `Order cancelled — ${fish} · #${orderIdShort}`,
        buyerHeading: "Order cancelled",
        buyerLine: `Your ${fish} order #${orderIdShort} couldn't be fulfilled and is cancelled.${why}${amt ? " Your payment" + amt + " is being refunded in full." : ""}`,
        sellerSubject: `You cancelled order #${orderIdShort} — ${fish}`,
        sellerHeading: "Order cancelled",
        sellerLine: `You cancelled ${fish} order #${orderIdShort}.${why} The buyer has been notified and refunded.`,
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

function shell(heading: string, line: string, orderId: string, cta: string, items = "", forSeller = false): string {
  const url = absoluteUrl(`/track/${orderId}`);
  const short = String(orderId).slice(0, 8).toUpperCase();
  const help = whatsappLink(forSeller ? `Hi Relifish, I'm a seller and need help with order #${short}` : `Hi Relifish, I need help with order #${short}`);
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
  <h1 style="font-size:22px;margin:0 0 12px;color:#0F172A;">${heading}</h1>
  <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 20px;">${line}</p>${items}
  <a href="${url}" style="display:inline-block;background:#0066cc;color:#fff;padding:12px 26px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;">${cta}</a>
  <p style="font-size:12px;color:#94A3B8;margin:24px 0 0;line-height:1.5;">Relifish · Mumbai<br/>Need help? <a href="${help}" target="_blank" style="color:#0066cc;">Message us on WhatsApp</a> · ${SUPPORT_EMAIL}</p>
</div>`;
}

/** Buyer push status string for each event (maps into buyer-order-push-copy). Exported for unit tests. */
export function pushStatusFor(event: OrderEvent): string {
  if (event === "payment_confirmed") return "paid";
  if (event === "cancelled_by_buyer" || event === "cancelled_by_seller") return "cancelled";
  if (event === "expired_unpaid") return "expired_unpaid";
  return "refunded";
}

/** Seller push kind for each event (maps into seller-push-copy). Exported for unit tests. */
export function sellerPushKindFor(event: OrderEvent): "payment_confirmed" | "cancelled" | "expired_unpaid" | "refunded" {
  if (event === "payment_confirmed") return "payment_confirmed";
  if (event === "cancelled_by_buyer" || event === "cancelled_by_seller") return "cancelled";
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
  /**
   * Rows that this one event covers (a cart paid or expired together). Defaults:
   * payment_confirmed → every row paid by the same Razorpay payment; else just order_id.
   * Both parties get ONE notification listing all of them, with the cart total.
   */
  order_ids?: string[];
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
    .select("id, buyer_id, buyer_phone, species, is_preorder, created_at, quantity, quantity_unit, total_price, delivery_fee, cancel_reason, payment_method, razorpay_payment_id, listing:fish_listings(species, seller_id, seller:sellers(id, name, email))")
    .eq("id", order_id)
    .single();

  if (error || !order) {
    console.warn(`[notify] order ${order_id} not found:`, error?.message);
    return out;
  }

  const o: any = order;
  // One cart → one notification: gather the rows this event covers.
  let ids = opts.order_ids?.length ? opts.order_ids : [order_id];
  if (!opts.order_ids?.length && event === "payment_confirmed" && o.razorpay_payment_id) {
    // Items closed before the payment landed carry it too (their share was refunded): not "paid".
    const { data: paidTogether } = await sb.from("orders").select("id, status").eq("razorpay_payment_id", o.razorpay_payment_id);
    const live = (paidTogether || []).filter((r: any) => isLiveRow(r.status));
    if (live.length) ids = live.map((r: any) => r.id);
  }
  let group: any[] = [o];
  if (ids.length > 1) {
    const { data: rows } = await sb.from("orders")
      .select("id, species, quantity, quantity_unit, total_price, delivery_fee, created_at, listing:fish_listings(species)")
      .in("id", ids).order("created_at", { ascending: true });
    if (rows?.length) group = rows;
  }
  const species = group.length > 1
    ? cartLabel(group.map((r: any) => r.listing?.species || r.species))
    : String(o.listing?.species || o.species || "fish");
  const orderIdShort = String(order_id).slice(0, 8).toUpperCase();
  const amt = amount ?? (group.reduce((sum: number, r: any) => sum + Number(r.total_price || 0) + Number(r.delivery_fee || 0), 0) || null);
  const itemsHtml = group.length > 1
    ? `<ul style="font-size:14px;line-height:1.7;color:#334155;margin:0 0 20px;padding-left:18px;">${group.map((r: any) =>
        `<li>${String(r.listing?.species || r.species || "Fish")} · ${Number(r.quantity)} ${r.quantity_unit || ""} · ₹${Number(r.total_price || 0).toLocaleString("en-IN")}</li>`).join("")}</ul>`
    : "";
  const typed = cancelReasonText(o.cancel_reason);
  const reason = typed && isLateCancel(o.cancel_reason) ? `Order was late — ${typed}` : typed;
  const istHour = Number(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(11, 13));
  const c = copyFor(event, species, orderIdShort, amt, reason, { seller: (o as any).listing?.seller?.name ?? null, eveningPreorder: !!(o as any).is_preorder && istHour >= 18 });
  const isCancel = event === "cancelled_by_buyer" || event === "cancelled_by_seller";

  // ---- WhatsApp: the seller hears about a new paid order (buyers get confirmed/out/delivered only) ----
  if (event === "payment_confirmed") {
    const { notifyOrderWhatsApp } = await import("./notify-order-whatsapp");
    await notifyOrderWhatsApp(order_id, "paid");
  }

  // ---- Buyer push ----
  try {
    const r = await sendBuyerOrderPush({
      buyer_id: o.buyer_id,
      buyer_phone: o.buyer_phone,
      status: pushStatusFor(event),
      species,
      order_id,
      cancel: isCancel
        ? { by: event === "cancelled_by_seller" ? "seller" : "buyer", reason, refunded: o.payment_method === "razorpay" && !!o.razorpay_payment_id }
        : null,
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
        ? await sendEmail(buyer.email, c.buyerSubject, withPreview(shell(c.buyerHeading, c.buyerLine, order_id, "View order", itemsHtml), c.buyerPreview), "buyer")
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

  if (event === "cancelled_by_seller") {
    out.seller_email = "skipped: seller cancelled it";
    out.seller_push = "skipped: seller cancelled it";
    console.log(`[notify] ${event} ${orderIdShort}`, JSON.stringify(out));
    return out;
  }

  out.seller_email = sellerEmail
    ? await sendEmail(sellerEmail, c.sellerSubject, shell(c.sellerHeading, c.sellerLine, order_id, "Open dashboard", itemsHtml, true), "seller")
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
          item_count: group.length,
          amount: amt,
          reason,
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
