/**
 * WhatsApp Cloud API (Meta, direct; no third-party provider). Template sends only: every
 * business-initiated message must use an approved template.
 *
 * Env: WA_PHONE_NUMBER_ID, WA_TOKEN (system-user token), WA_APP_SECRET (webhook signatures),
 * WA_VERIFY_TOKEN (webhook handshake), WA_DRY_RUN=true (log, never send),
 * WA_TEST_ONLY=919870619974[,…] (only these numbers get real sends; everyone else is dry-run).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const env = (k: string) => ((import.meta as any).env?.[k] ?? process.env[k] ?? "") as string;
export const GRAPH = "https://graph.facebook.com/v26.0";

/** Indian mobile → 91XXXXXXXXXX (WhatsApp ids have no +). null if it isn't one. */
export function waNumber(phone: string | null | undefined): string | null {
  const d = String(phone || "").replace(/\D/g, "");
  const ten = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 10 ? d : null;
  return ten && /^[6-9]\d{9}$/.test(ten) ? `91${ten}` : null;
}

export type TemplateSend = {
  to: string;                     // 91XXXXXXXXXX
  name: string;                   // approved template name
  lang?: string;                  // "en"
  headerImage?: string | null;    // https URL
  body?: string[];                // {{1}}, {{2}}… in order
  urlSuffix?: string | null;      // dynamic part of the URL button (button index 0)
  quickReplyPayload?: string | null; // e.g. "STOP" for the "Stop updates" button (index 1)
};

/** Build the Cloud API request body (pure; tested). */
export function templatePayload(t: TemplateSend) {
  const components: any[] = [];
  if (t.headerImage) components.push({ type: "header", parameters: [{ type: "image", image: { link: t.headerImage } }] });
  if (t.body?.length) components.push({ type: "body", parameters: t.body.map((text) => ({ type: "text", text: String(text) })) });
  if (t.urlSuffix) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: t.urlSuffix }] });
  if (t.quickReplyPayload) components.push({ type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: t.quickReplyPayload }] });
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: t.to,
    type: "template",
    template: { name: t.name, language: { code: t.lang || "en" }, ...(components.length ? { components } : {}) },
  };
}

export type SendResult = { status: "sent" | "dry_run" | "failed"; id?: string; error?: string };

/** Live only when configured, not WA_DRY_RUN, and (if WA_TEST_ONLY is set) the number is on it. */
export function isLiveFor(to: string): boolean {
  if (!env("WA_PHONE_NUMBER_ID") || !env("WA_TOKEN")) return false;
  if (env("WA_DRY_RUN") === "true") return false;
  const allow = env("WA_TEST_ONLY").split(",").map((s) => waNumber(s.trim())).filter(Boolean);
  return allow.length === 0 || allow.includes(to);
}

export async function sendTemplate(t: TemplateSend): Promise<SendResult> {
  if (!isLiveFor(t.to)) return { status: "dry_run" };
  try {
    const res = await fetch(`${GRAPH}/${env("WA_PHONE_NUMBER_ID")}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env("WA_TOKEN")}`, "Content-Type": "application/json" },
      body: JSON.stringify(templatePayload(t)),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) return { status: "failed", error: `${res.status} ${j?.error?.message || ""}`.trim().slice(0, 300) };
    return { status: "sent", id: j?.messages?.[0]?.id };
  } catch (err: any) {
    return { status: "failed", error: String(err?.message || err).slice(0, 300) };
  }
}

/** Plain text reply. Allowed only inside the 24 h window after the user messaged us. */
export async function sendText(to: string, text: string): Promise<SendResult> {
  if (!isLiveFor(to)) return { status: "dry_run" };
  const res = await fetch(`${GRAPH}/${env("WA_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WA_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  }).catch(() => null);
  return res?.ok ? { status: "sent" } : { status: "failed", error: `text ${res?.status ?? "network"}` };
}

/** Meta webhook signature: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body, app secret). */
export function validWebhookSignature(rawBody: string, header: string | null, secret = env("WA_APP_SECRET")): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
