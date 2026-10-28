/**
 * One place that sends a Relifish message and records it in message_log.
 * - Idempotent: the row is inserted first with a unique dedupe_key; if it already exists the
 *   message was handled before and nothing is sent again (job re-runs, duplicate webhooks).
 * - Channels: WhatsApp (opted in, valid number) and web push (buyers with a subscription), both.
 * - Every button/link points at /go/<message id>, which records the tap and redirects.
 */
import { sendCustomBuyerPush } from "./buyer-push";
import { sendTemplate, waNumber } from "./whatsapp";
import { TEMPLATE } from "../messaging/templates";

export type Dispatch = {
  dedupe_key: string;
  kind: string;
  slot_date: string;
  buyer_id?: string | null;
  seller_id?: string | null;
  order_id?: string | null;
  phone?: string | null;
  whatsappOk: boolean;              // opted in, not opted out
  template: string;
  body: string[];
  headerImage?: string | null;
  link_path: string;
  push?: { title: string; body: string; image?: string } | null; // buyer fallback
};
export type DispatchResult = { status: "duplicate" | "sent" | "dry_run" | "failed" | "no_channel"; channel?: string; id?: string; error?: string };

/**
 * Send on every channel the person has: WhatsApp (opted in + valid number) AND web push
 * (buyers with a subscription), founder 24 Oct. Each channel is its own message_log row
 * (dedupe_key + ":whatsapp" / ":push"), so a re-run never repeats either one.
 */
export async function dispatch(sb: any, d: Dispatch): Promise<DispatchResult> {
  const to = waNumber(d.phone);
  const channels: ("whatsapp" | "push")[] = [];
  if (d.whatsappOk && to) channels.push("whatsapp");
  if (d.push && d.buyer_id) channels.push("push");
  if (!channels.length) return { status: "no_channel" };
  const results = [];
  for (const ch of channels) results.push(await sendOne(sb, d, ch, to));
  const sent = results.find((r) => r.status === "sent");
  return sent ? { ...sent, channel: results.map((r) => `${r.channel}:${r.status}`).join(",") }
    : { ...results[0], channel: results.map((r) => `${r.channel}:${r.status}`).join(",") };
}

async function sendOne(sb: any, d: Dispatch, channel: "whatsapp" | "push", to: string | null): Promise<DispatchResult> {
  const { data: rows, error } = await sb.from("message_log").upsert({
    dedupe_key: `${d.dedupe_key}:${channel}`, kind: d.kind, slot_date: d.slot_date, channel, template: d.template,
    buyer_id: d.buyer_id ?? null, seller_id: d.seller_id ?? null, order_id: d.order_id ?? null,
    to_phone: channel === "whatsapp" ? to : null, link_path: d.link_path, status: "queued",
  }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
  if (error) return { status: "failed", channel, error: error.message };
  const id = rows?.[0]?.id as string | undefined;
  if (!id) return { status: "duplicate", channel };

  let r: { status: "sent" | "dry_run" | "failed"; id?: string; error?: string };
  // MESSAGING_TEST_ONLY=919870619974[,…]: while testing, only these people get real sends
  // (WhatsApp and push); everyone else is recorded as dry_run.
  const testOnly = String((import.meta as any).env?.MESSAGING_TEST_ONLY || process.env.MESSAGING_TEST_ONLY || "")
    .split(",").map((x) => waNumber(x.trim())).filter(Boolean);
  if (testOnly.length && !testOnly.includes(waNumber(d.phone))) {
    r = { status: "dry_run" };
  } else if (channel === "whatsapp") {
    // No quick-reply payload: rf2's second button is "I have a question" etc., not "Stop updates"
    // (a STOP payload there would opt the buyer out). STOP is typed, per the footer.
    r = await sendTemplate({
      to: to!, name: d.template, body: d.body, headerImage: TEMPLATE[d.template]?.header ? d.headerImage : null,
      urlSuffix: id,
    });
  } else {
    const p = await sendCustomBuyerPush(d.buyer_id!, { ...d.push! }, `/go/${id}`)
      .catch((e: any) => ({ ok: false, error: e?.message }) as any);
    r = p?.ok && p?.sent ? { status: "sent" } : { status: "failed", error: p?.error || p?.reason || "push not sent" };
  }
  await sb.from("message_log").update({ status: r.status, provider_id: r.id ?? null, error: r.error ?? null, updated_at: new Date().toISOString() }).eq("id", id);
  return { status: r.status, channel, id, error: r.error };
}
