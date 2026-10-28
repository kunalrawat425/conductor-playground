/**
 * WhatsApp Embedded Signup (coexistence) session-info message, posted to window by Facebook
 * while the founder goes through the flow on /admin/whatsapp-connect. Shape per Meta docs:
 * { type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" | "FINISH" | "CANCEL" | "ERROR" | …,
 *   data: { waba_id, phone_number_id?, business_id?, current_step?, error_message? } }.
 * The coexistence finish event carries only waba_id; the server looks the phone number up.
 */
export type SignupEvent = {
  event: string;
  waba_id?: string;
  phone_number_id?: string;
  business_id?: string;
  error?: string;
};

/** null unless the message is a WA_EMBEDDED_SIGNUP event from facebook.com. */
export function parseSignupMessage(origin: string, raw: unknown): SignupEvent | null {
  let host = "";
  try { host = new URL(origin).hostname; } catch { return null; }
  if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return null;
  let d: any = raw;
  if (typeof raw === "string") { try { d = JSON.parse(raw); } catch { return null; } }
  if (d?.type !== "WA_EMBEDDED_SIGNUP" || typeof d.event !== "string") return null;
  const x = d.data || {};
  const id = (v: unknown) => (typeof v === "string" || typeof v === "number") && /^\d+$/.test(String(v)) ? String(v) : undefined;
  return {
    event: d.event,
    waba_id: id(x.waba_id),
    phone_number_id: id(x.phone_number_id),
    business_id: id(x.business_id),
    error: x.error_message || (d.event === "CANCEL" && x.current_step ? `cancelled at ${x.current_step}` : undefined),
  };
}
