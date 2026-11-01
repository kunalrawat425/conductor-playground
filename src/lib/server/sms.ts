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

export type SmsKey = "SIGNUP" | "CART" | "UNPAID" | "PAID" | "CONFIRMED" | "OUT" | "DELIVERED" | "CANCELLED" | "CANCELLED_NOPAY";

/**
 * The DLT template text for each key (Smartping, 1 Nov 2026). Friendly reminders, never a dues notice; no seller
 * names (founder); no tracking wording (there's no live tracking): order links go to /orders ("Your Orders").
 * SIGNUP = relifish_account_ready, CART = relifish_checkout_saved, UNPAID = relifish_unpaid_saved,
 * CONFIRMED = relifish_confirmed_hi, OUT = relifish_order_on_way, CANCELLED = relifish_cancel_refund,
 * CANCELLED_NOPAY = relifish_cancel_nopay. PAID and DELIVERED aren't sent.
 */
export const SMS_TEXT: Record<SmsKey, string> = {
  SIGNUP: "Hi {#var#}, your Relifish account is ready. You can order fish from {#var#}, cleaned and cut, with home delivery. Menu: https://www.relifish.com/shop - Relifish",
  CART: "Hi {#var#}, your Relifish order for {#var#} is saved. Complete the checkout for home delivery {#var#}: https://www.relifish.com/shop - Relifish",
  UNPAID: "Hi {#var#}, your Relifish order for {#var#} is saved. Complete the checkout for home delivery {#var#}. Your orders: https://www.relifish.com/orders - Relifish",
  PAID: "Payment received for your Relifish order {#var#} from {#var#}. Delivery: {#var#}. Track: https://www.relifish.com/track - Relifish",
  CONFIRMED: "Hi {#var#}, your Relifish order {#var#} is confirmed and will reach you {#var#}, cleaned and cut. - Relifish",
  OUT: "Your Relifish order {#var#} is on the way and should reach you {#var#}. Please keep your phone close for the delivery person. - Relifish",
  DELIVERED: "Your Relifish order {#var#} ({#var#}) is delivered. Hope you enjoy it! Rate it: https://www.relifish.com/track - Relifish",
  CANCELLED: "Sorry {#var#}, your Relifish order {#var#} was cancelled: {#var#}. Your refund of {#var#} will reach your account in 5-7 working days. - Relifish",
  CANCELLED_NOPAY: "Sorry {#var#}, your Relifish order {#var#} was cancelled: {#var#}. No payment was taken. - Relifish",
};
/** Variables each key takes. */
export const smsVarCount = (key: SmsKey) => SMS_TEXT[key].split("{#var#}").length - 1;

/** DLT limit: a variable value is at most 30 characters. GSM only (Text templates): dashes, quotes and … become ASCII. */
export const cut30 = (s: string) => {
  const t = String(s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/\s+/g, " ").trim();
  return t.length <= 30 ? t : `${t.slice(0, 27).trimEnd()}...`;
};

/** MSG91 flow body (pure; tested): var1…varN. Same shape as the OTP sender. DLT text type is GSM, so ₹ becomes "Rs." */
export function smsPayload(flowId: string, to: string, vars: string[]) {
  const all = vars.map((v) => cut30(String(v ?? "").replace(/₹\s?/g, "Rs.")));
  const named = Object.fromEntries(all.flatMap((v, i) => [[`var${i + 1}`, v], [`VAR${i + 1}`, v]]));
  return { flow_id: flowId, sender: env("MSG91_SENDER_ID") || "RLFISH", mobiles: to, ...named };
}

/** The DLT template for this key is set up in MSG91 (env MSG91_FLOW_<KEY>). Until then SMS is skipped, not failed. */
export const smsReady = (key: SmsKey) => !!env(`MSG91_FLOW_${key}`);

export async function sendSms(to: string, key: SmsKey, vars: string[]): Promise<SendResult> {
  const flowId = env(`MSG91_FLOW_${key}`);
  if (!flowId) return { status: "failed", error: `sms template ${key} not configured (MSG91_FLOW_${key})` };
  if (env("SMS_LIVE") !== "true" || !env("MSG91_AUTH_KEY")) return { status: "dry_run" };
  try {
    const res = await fetch("https://api.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: { authkey: env("MSG91_AUTH_KEY"), "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify(smsPayload(flowId, to, vars)),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || j?.type !== "success") return { status: "failed", error: `msg91 ${res.status} ${j?.message || ""}`.trim().slice(0, 300) };
    return { status: "sent", id: String(j?.message || "") || undefined };
  } catch (err: any) {
    return { status: "failed", error: String(err?.message || err).slice(0, 300) };
  }
}
