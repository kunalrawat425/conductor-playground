import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { sendText, validWebhookSignature, waNumber } from "../../../lib/server/whatsapp";

export const prerender = false;
const env = (k: string) => (import.meta.env as any)[k] || process.env[k] || "";

/** GET: Meta's subscribe handshake (hub.verify_token must match WA_VERIFY_TOKEN). */
export const GET: APIRoute = async ({ url }) => {
  const ok = url.searchParams.get("hub.mode") === "subscribe" && !!env("WA_VERIFY_TOKEN")
    && url.searchParams.get("hub.verify_token") === env("WA_VERIFY_TOKEN");
  return ok ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 }) : new Response("forbidden", { status: 403 });
};

const STOP_WORDS = /^\s*(stop|stop updates|unsubscribe|band karo)\s*$/i;

/**
 * POST: delivery/read statuses and inbound messages. Signature-checked (X-Hub-Signature-256
 * with the app secret). Statuses update message_log (idempotent: only move forward).
 * "Stop updates" (button or text) sets buyers.whatsapp_opt_out_at and confirms once.
 * Everything else inbound is left for the founder in the WhatsApp app (no auto-replies).
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
      if (!(m?.button?.payload === "STOP" || STOP_WORDS.test(text))) continue;
      const phone = waNumber(m.from);
      if (!phone) continue;
      const ten = phone.slice(2);
      const { data: buyers } = await sb.from("buyers").select("id, whatsapp_opt_out_at").or(`phone.eq.${ten},phone.eq.+91${ten},phone.eq.91${ten}`);
      const fresh = (buyers || []).filter((b: any) => !b.whatsapp_opt_out_at);
      if (!fresh.length) continue;
      await sb.from("buyers").update({ whatsapp_opt_out_at: new Date().toISOString() }).in("id", fresh.map((b: any) => b.id));
      await sendText(phone, "Done. You won't get offers from Relifish on WhatsApp. Order updates for orders you place still come here.");
    }
  }
  return new Response("ok", { status: 200 });
};
