/**
 * SMS through MSG91 (DLT sender RLFISH): the channel for buyers who aren't opted in to WhatsApp,
 * and the one-time fallback when WhatsApp fails for a reminder or an order update (founder, 30 Oct).
 *
 * Each SMS is a DLT-approved MSG91 template. Its id is env MSG91_FLOW_<KEY>, and its variables are
 * named var1…varN in MSG91, in the order below. Texts match the Smartping registrations of 1 Nov 2026
 * word for word. Links are fixed, whitelisted static URLs (/shop for reminders, /track for orders):
 * Smartping only allows static URLs or dynamic ones that don't redirect, and /go/<code> redirects.
 * ponytail: no per-SMS click tracking; add a non-redirecting /go?<code> page + Dynamic URL CTA if it's needed.
 * A DLT variable is at most 30 characters, so every value is cut to 30.
 *
 * Gates: SMS_LIVE=true sends; anything else is dry_run. MESSAGING_TEST_ONLY applies in dispatch().
 */
import type { SendResult } from "./whatsapp";

const env = (k: string) => ((import.meta as any).env?.[k] ?? process.env[k] ?? "") as string;

export type SmsKey = "SIGNUP" | "CART" | "UNPAID" | "PAID" | "CONFIRMED" | "OUT" | "DELIVERED" | "CANCELLED" | "CANCELLED_NOPAY"
  | "PROMO_NEW" | "PROMO_CART" | "PROMO_AGAIN";

/**
 * The DLT template text for each key (Smartping, 1 Nov 2026), in the WhatsApp voice: a status line, then help
 * ("WhatsApp or call us on 9152207607"). Never a dues notice, no seller names, no tracking wording (order links go
 * to /orders). SIGNUP = relifish_signup_care, CART = relifish_order_not_placed, UNPAID = relifish_unpaid_help, CONFIRMED =
 * relifish_confirmed_care, OUT = relifish_out_care, CANCELLED = relifish_cancel_refund_care, CANCELLED_NOPAY =
 * relifish_cancel_nopay_care. PAID and DELIVERED aren't sent.
 */
export const SMS_TEXT: Record<SmsKey, string> = {
  SIGNUP: "Hi {#var#}, your Relifish account is ready. Fresh fish from {#var#}, cleaned and cut, delivered home. Not sure what to pick? WhatsApp or call us on 9152207607, a real person replies. Menu: https://www.relifish.com/shop - Relifish",
  CART: "Hi {#var#}, your Relifish order for {#var#} is not placed yet. Stuck anywhere? WhatsApp or call us on 9152207607, we will sort it out. Menu: https://www.relifish.com/shop - Relifish",
  UNPAID: "Hi {#var#}, your Relifish order for {#var#} is almost done. The payment is pending for your delivery slot {#var#}. Stuck anywhere? WhatsApp or call us on 9152207607, we will sort it out. Your orders: https://www.relifish.com/orders - Relifish",
  PAID: "Payment received for your Relifish order {#var#} from {#var#}. Delivery: {#var#}. Track: https://www.relifish.com/track - Relifish",
  CONFIRMED: "Hi {#var#}, your Relifish order {#var#} is confirmed and will reach you {#var#}, cleaned and cut. We will text you when it is on the way. Questions? WhatsApp or call us on 9152207607. - Relifish",
  OUT: "Your Relifish order {#var#} is on the way and should reach you {#var#}. Please keep your phone close for the delivery person. Anything urgent? Call us on 9152207607. - Relifish",
  DELIVERED: "Your Relifish order {#var#} ({#var#}) is delivered. Hope you enjoy it! Rate it: https://www.relifish.com/track - Relifish",
  CANCELLED: "Sorry {#var#}, your Relifish order {#var#} could not go ahead: {#var#}. Your refund of {#var#} will reach your account in 5-7 working days. Want another fish or slot? WhatsApp or call us on 9152207607. - Relifish",
  CANCELLED_NOPAY: "Sorry {#var#}, your Relifish order {#var#} could not go ahead: {#var#}. No payment was taken. Want another fish or slot? WhatsApp or call us on 9152207607. - Relifish",
  // Promotional (DLT category Promotional, sent from the numeric promo header MSG91_PROMO_SENDER, 10:00–21:00 only).
  PROMO_NEW: "Hi {#var#}, verified fish sellers delivering near you: {#var#}. Next delivery {#var#}, cleaned and cut. See what's fresh: https://www.relifish.com/shop - Relifish",
  PROMO_CART: "Hi {#var#}, your {#var#} is still in your Relifish cart. The next delivery slot is {#var#}, cleaned and cut. Questions? Call 9152207607. Cart: https://www.relifish.com/shop - Relifish",
  PROMO_AGAIN: "Hi {#var#}, hope you enjoyed the {#var#}. Fresh stock is in, next slot {#var#}, cleaned and cut. Order again: https://www.relifish.com/shop - Relifish",
};
/** Promotional keys: own sender (numeric header) and their own switch PROMO_SMS_LIVE, separate from reminders. */
export const isPromoSms = (key: SmsKey) => key.startsWith("PROMO_");
/** Variables each key takes. */
export const smsVarCount = (key: SmsKey) => SMS_TEXT[key].split("{#var#}").length - 1;

/** DLT limit: a variable value is at most 30 characters. GSM only (Text templates): dashes, quotes and … become ASCII. */
export const cut30 = (s: string) => {
  const t = String(s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/\s+/g, " ").trim();
  return t.length <= 30 ? t : `${t.slice(0, 27).trimEnd()}...`;
};

/** MSG91 flow body (pure; tested): var1…varN. Same shape as the OTP sender. DLT text type is GSM, so ₹ becomes "Rs." */
export function smsPayload(flowId: string, to: string, vars: string[], promo = false) {
  const all = vars.map((v) => cut30(String(v ?? "").replace(/₹\s?/g, "Rs.")));
  const named = Object.fromEntries(all.flatMap((v, i) => [[`var${i + 1}`, v], [`VAR${i + 1}`, v]]));
  return { flow_id: flowId, sender: promo ? env("MSG91_PROMO_SENDER") : env("MSG91_SENDER_ID") || "RLFISH", mobiles: to, ...named };
}

/** The DLT template for this key is set up in MSG91 (env MSG91_FLOW_<KEY>). Until then SMS is skipped, not failed. */
export const smsReady = (key: SmsKey) =>
  !!env(`MSG91_FLOW_${key}`) && (!isPromoSms(key) || (env("PROMO_SMS_LIVE") === "true" && !!env("MSG91_PROMO_SENDER")));

export async function sendSms(to: string, key: SmsKey, vars: string[]): Promise<SendResult> {
  const flowId = env(`MSG91_FLOW_${key}`);
  if (!flowId) return { status: "failed", error: `sms template ${key} not configured (MSG91_FLOW_${key})` };
  if (env("SMS_LIVE") !== "true" || !env("MSG91_AUTH_KEY")) return { status: "dry_run" };
  if (isPromoSms(key) && !smsReady(key)) return { status: "dry_run" }; // promo switch off or no promo header
  try {
    const res = await fetch("https://api.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: { authkey: env("MSG91_AUTH_KEY"), "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify(smsPayload(flowId, to, vars, isPromoSms(key))),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || j?.type !== "success") return { status: "failed", error: `msg91 ${res.status} ${j?.message || ""}`.trim().slice(0, 300) };
    return { status: "sent", id: String(j?.message || "") || undefined };
  } catch (err: any) {
    return { status: "failed", error: String(err?.message || err).slice(0, 300) };
  }
}
