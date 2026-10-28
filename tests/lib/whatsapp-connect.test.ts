import { describe, expect, it } from "vitest";
import { parseSignupMessage } from "../../src/lib/whatsapp-connect";
import { echoLogRow, webhookSummary } from "../../src/lib/server/whatsapp";

describe("parseSignupMessage (Embedded Signup session info)", () => {
  const finish = JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", version: 3, data: { waba_id: "1491951102724224" } });

  it("reads the coexistence finish event (string payload) from facebook.com", () => {
    expect(parseSignupMessage("https://www.facebook.com", finish)).toEqual({
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", waba_id: "1491951102724224", phone_number_id: undefined, business_id: undefined, error: undefined,
    });
  });

  it("ignores other origins, look-alike hosts and other message types", () => {
    expect(parseSignupMessage("https://evil.com", finish)).toBeNull();
    expect(parseSignupMessage("https://notfacebook.com", finish)).toBeNull();
    expect(parseSignupMessage("https://web.facebook.com", "{not json")).toBeNull();
    expect(parseSignupMessage("https://web.facebook.com", { type: "OTHER", event: "FINISH" })).toBeNull();
  });

  it("keeps only numeric ids and surfaces cancel/error reasons", () => {
    const e = parseSignupMessage("https://www.facebook.com", { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "12345", phone_number_id: "../x", business_id: 678 } });
    expect(e).toMatchObject({ waba_id: "12345", phone_number_id: undefined, business_id: "678" });
    expect(parseSignupMessage("https://www.facebook.com", { type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE_NUMBER_SETUP" } })?.error).toBe("cancelled at PHONE_NUMBER_SETUP");
    expect(parseSignupMessage("https://www.facebook.com", { type: "WA_EMBEDDED_SIGNUP", event: "ERROR", data: { error_message: "boom" } })?.error).toBe("boom");
  });
});

describe("coexistence webhook helpers", () => {
  it("summarises fields without message text or numbers", () => {
    expect(webhookSummary("account_update", { event: "PARTNER_REMOVED" })).toBe("[wa-webhook] account_update event=PARTNER_REMOVED");
    expect(webhookSummary("smb_app_state_sync", { state_sync: [{ contact: { phone_number: "919999999999" } }, {}] })).toBe("[wa-webhook] smb_app_state_sync contacts=2");
    const h = webhookSummary("history", { history: [{ metadata: { phase: 0, chunk_order: 1, progress: 50 }, threads: [{ id: "x", messages: [{ text: { body: "secret" } }] }] }] });
    expect(h).toBe("[wa-webhook] history phase=0 chunk=1 progress=50 threads=1");
    expect(webhookSummary("history", { history: [{ errors: [{ code: 2593109, title: "declined" }] }] })).toBe("[wa-webhook] history error=2593109 declined");
  });

  it("turns an echo into an idempotent manual message_log row", () => {
    const row = echoLogRow({ id: "wamid.A", from: "919152207607", to: "919876543210", timestamp: "1761600000", type: "text", text: { body: "hi" } });
    expect(row).toEqual({ dedupe_key: "echo:wamid.A", kind: "manual", channel: "whatsapp", template: null, to_phone: "919876543210",
      slot_date: "2025-10-28", status: "sent", provider_id: "wamid.A" });
    expect(echoLogRow({ to: "919876543210" })).toBeNull();
  });
});
