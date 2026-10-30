/**
 * SMS through MSG91 (DLT sender RELFSH): the channel for buyers who aren't opted in to WhatsApp,
 * and the one-time fallback when WhatsApp fails for a reminder or an order update (founder, 30 Oct).
 *
 * Each SMS is a DLT-approved MSG91 template. Its id is env MSG91_FLOW_<KEY>, and its variables are
 * named var1…varN in MSG91, in the order below. The last variable of every template is the
 * /go/<short_id> code of the link "https://www.relifish.com/go/{#var#}".
 * A DLT variable is at most 30 characters, so every value is cut to 30.
 *
 * Gates: SMS_LIVE=true sends; anything else is dry_run. MESSAGING_TEST_ONLY applies in dispatch().
 */
import type { SendResult } from "./whatsapp";

const env = (k: string) => ((import.meta as any).env?.[k] ?? process.env[k] ?? "") as string;

export type SmsKey = "SIGNUP" | "CART" | "UNPAID" | "PAID" | "CONFIRMED" | "OUT" | "DELIVERED" | "CANCELLED";

/** The DLT template text for each key (founder registers these; {#var#} in this order, the link code last). */
export const SMS_TEXT: Record<SmsKey, string> = {
  SIGNUP: "Welcome to Relifish {#var#}! Fresh fish from {#var#}, cleaned, cut and delivered home. See today's fish: https://www.relifish.com/go/{#var#} - RELFSH",
  CART: "Hi {#var#}, your {#var#} from {#var#} is still in your Relifish cart. Next slot: {#var#}. Order here: https://www.relifish.com/go/{#var#} - RELFSH",
  UNPAID: "Hi {#var#}, your Relifish order for {#var#} is not paid yet. Pay to keep your slot {#var#}: https://www.relifish.com/go/{#var#} - RELFSH",
  PAID: "Payment received for your Relifish order {#var#} from {#var#}. Delivery: {#var#}. Track: https://www.relifish.com/go/{#var#} - RELFSH",
  CONFIRMED: "{#var#} has confirmed your Relifish order {#var#}. Delivery: {#var#}. Track: https://www.relifish.com/go/{#var#} - RELFSH",
  OUT: "Your Relifish order {#var#} is out for delivery, arriving {#var#}. Track: https://www.relifish.com/go/{#var#} - RELFSH",
  DELIVERED: "Your Relifish order {#var#} ({#var#}) is delivered. Hope you enjoy it! Rate it: https://www.relifish.com/go/{#var#} - RELFSH",
  CANCELLED: "Your Relifish order {#var#} was cancelled: {#var#}. Refund: {#var#}. Details: https://www.relifish.com/go/{#var#} - RELFSH",
};
/** Variables each key takes before the link code. */
export const smsVarCount = (key: SmsKey) => SMS_TEXT[key].split("{#var#}").length - 2;

/** DLT limit: a variable value is at most 30 characters. */
export const cut30 = (s: string) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= 30 ? t : `${t.slice(0, 29).trimEnd()}…`;
};

/** MSG91 flow body (pure; tested): var1…varN, the link code last. Same shape as the OTP sender. */
export function smsPayload(flowId: string, to: string, vars: string[], code: string) {
  const all = [...vars.map(cut30), code];
  const named = Object.fromEntries(all.flatMap((v, i) => [[`var${i + 1}`, v], [`VAR${i + 1}`, v]]));
  return { flow_id: flowId, sender: env("MSG91_SENDER_ID") || "RELFSH", mobiles: to, ...named };
}

/** The DLT template for this key is set up in MSG91 (env MSG91_FLOW_<KEY>). Until then SMS is skipped, not failed. */
export const smsReady = (key: SmsKey) => !!env(`MSG91_FLOW_${key}`);

export async function sendSms(to: string, key: SmsKey, vars: string[], code: string): Promise<SendResult> {
  const flowId = env(`MSG91_FLOW_${key}`);
  if (!flowId) return { status: "failed", error: `sms template ${key} not configured (MSG91_FLOW_${key})` };
  if (env("SMS_LIVE") !== "true" || !env("MSG91_AUTH_KEY")) return { status: "dry_run" };
  try {
    const res = await fetch("https://api.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: { authkey: env("MSG91_AUTH_KEY"), "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify(smsPayload(flowId, to, vars, code)),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || j?.type !== "success") return { status: "failed", error: `msg91 ${res.status} ${j?.message || ""}`.trim().slice(0, 300) };
    return { status: "sent", id: String(j?.message || "") || undefined };
  } catch (err: any) {
    return { status: "failed", error: String(err?.message || err).slice(0, 300) };
  }
}
