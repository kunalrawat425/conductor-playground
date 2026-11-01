/**
 * One place that sends a Relifish message to a buyer and records it in message_log.
 * - One channel per message (founder, 30 Oct): WhatsApp when the buyer opted in, else SMS (MSG91).
 *   WHATSAPP_OFF=true (founder, 1 Nov: Wati paused) sends everything by SMS; promos have no SMS, so they stop.
 *   A reminder or order update whose WhatsApp fails is re-sent once by SMS (smsFallback), now or
 *   later when Wati reports the failure (smsFallbackFor, from the messaging cron).
 * - Idempotent: each channel's row is inserted first with a unique dedupe_key (key + ":whatsapp" /
 *   ":sms"); a message already handled on either channel is never sent again.
 * - Every link points at /go/<id> (WhatsApp button) or /go/<short_id> (SMS), which records the tap.
 */
import { sendTemplate, waNumber, type SendResult } from "./whatsapp";
import { sendSms, smsReady, type SmsKey } from "./sms";
import { TEMPLATE } from "../messaging/templates";
import { inSendHours } from "../messaging/schedule";

export type SmsPart = { key: SmsKey; vars: string[] };
export type Dispatch = {
  dedupe_key: string;
  kind: string;
  slot_date: string;
  buyer_id?: string | null;
  seller_id?: string | null;
  order_id?: string | null;
  phone?: string | null;
  whatsappOk: boolean;              // opted in (and, for reminders/promos, not opted out)
  template: string;
  body: string[];
  headerImage?: string | null;
  link_path: string;
  sms?: SmsPart | null;             // the SMS version; none → WhatsApp only (promos)
  smsOk?: boolean;                  // false → never SMS (DND, STOP for reminders)
  smsFallback?: boolean;            // WhatsApp failed → SMS once (reminders, order updates)
};
type Channel = "whatsapp" | "sms";
export type DispatchResult = { status: "duplicate" | "sent" | "dry_run" | "failed" | "no_channel" | "capped"; channel?: string; id?: string; error?: string };

const env = (k: string) => ((import.meta as any).env?.[k] ?? process.env[k] ?? "") as string;

export async function dispatch(sb: any, d: Dispatch): Promise<DispatchResult> {
  const to = waNumber(d.phone);
  if (!to) return { status: "no_channel" };
  // No SMS until its DLT template is set up in MSG91: nothing is logged, so the reminder can still go once it is.
  const canSms = !!d.sms && d.smsOk !== false && smsReady(d.sms.key);
  const { data: prior } = await sb.from("message_log").select("channel, status")
    .in("dedupe_key", [`${d.dedupe_key}:whatsapp`, `${d.dedupe_key}:sms`]);
  const wa = (prior || []).find((p: any) => p.channel === "whatsapp");
  if ((prior || []).some((p: any) => p.channel === "sms")) return { status: "duplicate", channel: "sms" };
  if (wa) {
    // Handled on WhatsApp before; only a failed one may still go once by SMS.
    return wa.status === "failed" && d.smsFallback && canSms ? sendOne(sb, d, "sms", to) : { status: "duplicate", channel: "whatsapp" };
  }
  if (d.whatsappOk && env("WHATSAPP_OFF") !== "true") {
    const r = await sendOne(sb, d, "whatsapp", to);
    if (r.status !== "failed" || !d.smsFallback || !canSms) return r;
    const s = await sendOne(sb, d, "sms", to);
    return { ...s, channel: `whatsapp:failed,sms:${s.status}` };
  }
  return canSms ? sendOne(sb, d, "sms", to) : { status: "no_channel" };
}

/**
 * May a failed WhatsApp row go by SMS at `now`? Never a "stuck in queue" row (its WhatsApp may have
 * gone out). Reminders (act_*) only 8 AM–9 PM and within 60 min of the WhatsApp; the caller also
 * re-checks they're still true. Order updates: any time (within the cron's 6 h look-back).
 */
export function smsFallbackDue(row: { kind?: string; error?: string | null; created_at?: string }, now: number): boolean {
  if (String(row.error || "").startsWith("stuck in queue")) return false;
  if (!String(row.kind).startsWith("act_")) return true;
  return inSendHours(now) && now - Date.parse(String(row.created_at)) < 60 * 60_000;
}

/**
 * A WhatsApp row Wati later reported as failed → the same message once by SMS, from its stored
 * payload. Only rows whose payload has an SMS version and smsFallback (reminders, order updates).
 */
export async function smsFallbackFor(sb: any, row: any): Promise<DispatchResult> {
  const p = row?.payload;
  if (!p?.sms || !p?.smsFallback || p?.smsOk === false) return { status: "no_channel" };
  const base = String(row.dedupe_key).replace(/:whatsapp$/, "");
  return dispatch(sb, {
    dedupe_key: base, kind: row.kind, slot_date: row.slot_date, buyer_id: row.buyer_id, seller_id: row.seller_id, order_id: row.order_id,
    phone: row.to_phone, whatsappOk: false, template: row.template, body: p.body || [], link_path: row.link_path,
    sms: p.sms, smsOk: true, smsFallback: true,
  });
}

async function sendOne(sb: any, d: Dispatch, channel: Channel, to: string): Promise<DispatchResult> {
  const { data: rows, error } = await sb.from("message_log").upsert({
    dedupe_key: `${d.dedupe_key}:${channel}`, kind: d.kind, slot_date: d.slot_date, channel,
    template: channel === "sms" ? `sms:${d.sms!.key}` : d.template,
    buyer_id: d.buyer_id ?? null, seller_id: d.seller_id ?? null, order_id: d.order_id ?? null,
    to_phone: to, link_path: d.link_path, status: "queued",
    payload: { template: d.template, body: d.body, headerImage: d.headerImage ?? null, sms: d.sms ?? null, smsOk: d.smsOk ?? true, smsFallback: !!d.smsFallback },
  }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id, short_id");
  // 23505 here is the other unique index (migration 089): this buyer already has a marketing WhatsApp today.
  if (error) {
    if (error.code === "23505") return { status: "duplicate", channel };
    // Migration 091: the database refuses a 3rd reminder/promo SMS to a number within 7 days. Nothing was written or sent.
    if (/sms_weekly_cap/.test(String(error.message))) return { status: "capped", channel, error: "2 reminder/promo SMS in the last 7 days" };
    return { status: "failed", channel, error: error.message };
  }
  const id = rows?.[0]?.id as string | undefined;
  if (!id) return { status: "duplicate", channel };

  let r: SendResult;
  // MESSAGING_TEST_ONLY=919870619974[,…]: while testing, only these numbers get real sends.
  const testOnly = env("MESSAGING_TEST_ONLY").split(",").map((x) => waNumber(x.trim())).filter(Boolean);
  if (testOnly.length && !testOnly.includes(to)) {
    r = { status: "dry_run" };
  } else if (channel === "whatsapp") {
    // No quick-reply payload: rf2's second button is "I have a question" etc., not "Stop updates"
    // (a STOP payload there would opt the buyer out). STOP is typed, per the footer.
    r = await sendTemplate({ to, name: d.template, body: d.body, headerImage: TEMPLATE[d.template]?.header ? d.headerImage : null, urlSuffix: id });
  } else {
    r = await sendSms(to, d.sms!.key, d.sms!.vars);
  }
  await sb.from("message_log").update({ status: r.status, provider_id: r.id ?? null, error: r.error ?? null, updated_at: new Date().toISOString() }).eq("id", id);
  return { status: r.status, channel, id, error: r.error };
}
