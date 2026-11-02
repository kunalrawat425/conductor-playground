import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { echoLogRow, inboundLogRow, sendText, validWebhookSignature, waNumber, webhookSummary } from "../../../lib/server/whatsapp";
import { sendTransactionalEmail } from "../../../lib/server/send-email";
import { SUPPORT_EMAIL } from "../../../lib/brand";
import { optOutPhone, STOP_WORDS } from "../../../lib/server/wa-optout";

export const prerender = false;
const env = (k: string) => (import.meta.env as any)[k] || process.env[k] || "";

/** GET: Meta's subscribe handshake (hub.verify_token must match WA_VERIFY_TOKEN). */
export const GET: APIRoute = async ({ url }) => {
  const ok = url.searchParams.get("hub.mode") === "subscribe" && !!env("WA_VERIFY_TOKEN")
    && url.searchParams.get("hub.verify_token") === env("WA_VERIFY_TOKEN");
  return ok ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 }) : new Response("forbidden", { status: 403 });
};

/**
 * POST: delivery/read statuses and inbound messages. Signature-checked (X-Hub-Signature-256
 * with the app secret). Statuses update message_log (idempotent: only move forward).
 * "Stop updates" (button or text) sets buyers.whatsapp_opt_out_at and confirms once.
 * Every other inbound message is saved in message_log (kind "inbound") and emailed to us: the number
 * is on our Cloud API app, so these reach neither Wati nor the phone app (founder, 2 Nov). No auto-replies.
 * Coexistence fields (history, smb_app_state_sync, smb_message_echoes, account_update) are
 * logged as one line; echoes (the founder's sends from the phone app) also go into message_log.
 */
export const POST: APIRoute = async ({ request }) => {
  const raw = await request.text();
  if (!validWebhookSignature(raw, request.headers.get("x-hub-signature-256"))) return new Response("bad signature", { status: 401 });
  let body: any;
  try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const sb = createClient(env("PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_KEY"));
  const rank: Record<string, number> = { queued: 0, dry_run: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

  for (const entry of body?.entry || []) for (const change of entry?.changes || []) {
    const v = change?.value || {};
    if (change?.field && change.field !== "messages") console.log(webhookSummary(change.field, v));
    const echoes = (v.message_echoes || []).map(echoLogRow).filter(Boolean);
    if (echoes.length) await sb.from("message_log").upsert(echoes, { onConflict: "dedupe_key", ignoreDuplicates: true });
    for (const st of v.statuses || []) {
      if (!st?.id || !st?.status) continue;
      const { data: row } = await sb.from("message_log").select("id, status").eq("provider_id", st.id).maybeSingle();
      if (!row || (rank[st.status] ?? -1) <= (rank[row.status] ?? -1)) continue; // dedupe / out-of-order
      await sb.from("message_log").update({
        status: st.status, updated_at: new Date().toISOString(),
        error: st.errors?.[0] ? `${st.errors[0].code} ${st.errors[0].title || ""}`.trim() : null,
      }).eq("id", row.id);
    }
    for (const m of v.messages || []) {
      const text = m?.button?.payload || m?.button?.text || m?.interactive?.button_reply?.title || m?.text?.body || "";
      if (!(m?.button?.payload === "STOP" || STOP_WORDS.test(text))) {
        const row = inboundLogRow(m, v.contacts);
        if (!row) continue;
        const { data: saved } = await sb.from("message_log").upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
        if (saved?.length) await alertInbound(row); // first delivery only (Meta retries webhooks)
        continue;
      }
      const phone = waNumber(m.from);
      if (!phone) continue;
      if (!(await optOutPhone(sb, phone))) continue;
      await sendText(phone, "Done. You won't get offers from Relifish on WhatsApp. Order updates for orders you place still come here.");
    }
  }
  return new Response("ok", { status: 200 });
};

/** Email us each new inbound WhatsApp so nobody waits on a message no one sees. */
async function alertInbound(row: { to_phone: string | null; payload: { text: string; name: string | null } }) {
  const who = `${row.payload.name ? row.payload.name + " · " : ""}+${row.to_phone}`;
  const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<p><b>${esc(who)}</b> sent a WhatsApp to 91522 07607:</p><blockquote>${esc(row.payload.text)}</blockquote>`
    + `<p><a href="tel:+${row.to_phone}">Call them</a> · <a href="https://wa.me/${row.to_phone}">Reply on WhatsApp</a></p>`;
  console.log("[wa inbound]", await sendTransactionalEmail(SUPPORT_EMAIL, `WhatsApp from ${who}`, html, "wa_inbound"));
}
