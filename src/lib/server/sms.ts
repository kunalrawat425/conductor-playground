/**
 * SMS through the MSG91 Flow API (DLT-approved templates). Used by the login OTP and by the
 * buyer order SMS (confirmed / out for delivery / delivered). Template texts: docs/sms-dlt-templates.md.
 */
import { normalizeIndianMobile } from "../indian-phone";

const env = {
  authKey: () => import.meta.env?.MSG91_AUTH_KEY || process.env.MSG91_AUTH_KEY || "",
  sender: () => import.meta.env?.MSG91_SENDER_ID || process.env.MSG91_SENDER_ID || "RELFSH",
  enabled: () => (import.meta.env?.PUBLIC_ENABLE_MSG91 || process.env.PUBLIC_ENABLE_MSG91) === "true",
  flow: {
    confirmed: () => import.meta.env?.MSG91_FLOW_ORDER_CONFIRMED || process.env.MSG91_FLOW_ORDER_CONFIRMED || "",
    out_for_delivery: () => import.meta.env?.MSG91_FLOW_OUT_FOR_DELIVERY || process.env.MSG91_FLOW_OUT_FOR_DELIVERY || "",
    completed: () => import.meta.env?.MSG91_FLOW_DELIVERED || process.env.MSG91_FLOW_DELIVERED || "",
  },
};

/** Send one flow SMS. `phone` is 91XXXXXXXXXX; `vars` map to the flow's ##var## names. Never logs the payload (OTP / phone). */
export async function sendSms(phone: string, flowId: string, vars: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("https://api.msg91.com/api/v5/flow/", {
    method: "POST",
    headers: { authkey: env.authKey(), "Content-Type": "application/json" },
    body: JSON.stringify({ flow_id: flowId, sender: env.sender(), mobiles: phone, ...vars }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.type === "success") return { ok: true };
  console.warn("[sms] MSG91 rejected", { status: res.status, type: data.type });
  return { ok: false, error: data.message || `MSG91 error (${res.status})` };
}

export type OrderSmsStatus = keyof typeof env.flow;

/** DLT template texts, in variable order. Keep in sync with docs/sms-dlt-templates.md. */
export const ORDER_SMS_TEMPLATES: Record<OrderSmsStatus, string> = {
  confirmed: "Relifish: Your order {#var#} for {#var#} is confirmed. Delivery: {#var#}. Track: https://www.relifish.com/track",
  out_for_delivery: "Relifish: Your order {#var#} is out for delivery, arriving by {#var#}. Track: https://www.relifish.com/track",
  completed: "Relifish: Your order {#var#} has been delivered. Enjoy your fish! Track: https://www.relifish.com/track",
};

/** DLT variables: plain ASCII (one SMS segment, no Unicode) and at most 30 characters. */
export function smsVar(s: string): string {
  const v = String(s || "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
  return v.length > 30 ? `${v.slice(0, 27).trimEnd()}...` : v;
}

/** Variables for a status, e.g. confirmed: ["#AB12CD34", "Rohu", "Sat 25 Oct, 9-11 AM"]. */
export function orderSmsVars(status: OrderSmsStatus, o: { id: string; fish: string; when: string }): string[] {
  const short = `#${String(o.id).slice(0, 8).toUpperCase()}`;
  if (status === "confirmed") return [short, smsVar(o.fish), smsVar(o.when)];
  if (status === "out_for_delivery") return [short, smsVar(o.when)];
  return [short];
}

/** The SMS as the buyer reads it (previews and tests). */
export function renderOrderSms(status: OrderSmsStatus, vars: string[]): string {
  let i = 0;
  return ORDER_SMS_TEMPLATES[status].replace(/\{#var#\}/g, () => vars[i++] ?? "");
}

/**
 * Buyer SMS for a delivery order moving to confirmed / out_for_delivery / completed.
 * Skips (returns why) when MSG91 is off, the order is a test order (QA seller or test buyer:
 * orders.is_test), the flow id env var is unset, or the phone is invalid. Never throws.
 */
export async function sendOrderSms(
  status: string,
  o: { id: string; phone?: string | null; fish: string; when: string; is_test?: boolean | null; order_type?: string | null }
): Promise<string> {
  try {
    if (!(status in env.flow)) return "skipped: no SMS for this status";
    if (!env.enabled()) return "skipped: MSG91 disabled";
    if (o.is_test) return "skipped: test order";
    if (o.order_type !== "delivery") return "skipped: not a delivery order";
    const flowId = env.flow[status as OrderSmsStatus]();
    if (!flowId) {
      console.info(`[sms] no flow id for ${status}; set the MSG91_FLOW_* env var to send it`);
      return "skipped: flow id unset";
    }
    const phone = normalizeIndianMobile(String(o.phone || ""));
    if (!phone.ok) return "skipped: no valid phone";
    const vars = orderSmsVars(status as OrderSmsStatus, o);
    // MSG91 flows name variables var1, var2…; send VAR1… too, like the OTP flow.
    const named = Object.fromEntries(vars.flatMap((v, i) => [[`var${i + 1}`, v], [`VAR${i + 1}`, v]]));
    const r = await sendSms(`91${phone.digits10}`, flowId, named);
    return r.ok ? "sent" : `failed: ${r.error}`;
  } catch (err: any) {
    console.warn("[sms] order SMS threw", { order_id: o.id, err: err?.message });
    return `failed: ${err?.message}`;
  }
}
