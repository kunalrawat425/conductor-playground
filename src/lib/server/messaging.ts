/**
 * One place that sends a Relifish message and records it in message_log.
 * - Idempotent: the row is inserted first with a unique dedupe_key; if it already exists the
 *   message was handled before and nothing is sent again (job re-runs, duplicate webhooks).
 * - Channel: WhatsApp when the person opted in and has a valid number; else (buyers) web push
 *   when they have a subscription; else nothing.
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

export async function dispatch(sb: any, d: Dispatch): Promise<DispatchResult> {
  const to = waNumber(d.phone);
  const channel = d.whatsappOk && to ? "whatsapp" : d.push && d.buyer_id ? "push" : null;
  if (!channel) return { status: "no_channel" };

  const { data: rows, error } = await sb.from("message_log").upsert({
    dedupe_key: d.dedupe_key, kind: d.kind, slot_date: d.slot_date, channel, template: d.template,
    buyer_id: d.buyer_id ?? null, seller_id: d.seller_id ?? null, order_id: d.order_id ?? null,
    to_phone: channel === "whatsapp" ? to : null, link_path: d.link_path, status: "queued",
  }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
  if (error) return { status: "failed", error: error.message };
  const id = rows?.[0]?.id as string | undefined;
  if (!id) return { status: "duplicate" };

  let r: { status: "sent" | "dry_run" | "failed"; id?: string; error?: string };
  if (channel === "whatsapp") {
    const marketing = TEMPLATE[d.template]?.category === "MARKETING";
    r = await sendTemplate({
      to: to!, name: d.template, body: d.body, headerImage: TEMPLATE[d.template]?.header ? d.headerImage : null,
      urlSuffix: id, quickReplyPayload: marketing ? "STOP" : null,
    });
  } else {
    const p = await sendCustomBuyerPush(d.buyer_id!, { ...d.push!, ...(d.push?.image ? { image: d.push.image } : {}) }, `/go/${id}`)
      .catch((e: any) => ({ ok: false, error: e?.message }) as any);
    r = p?.ok && p?.sent ? { status: "sent" } : { status: "failed", error: p?.error || p?.reason || "push not sent" };
  }
  await sb.from("message_log").update({ status: r.status, provider_id: r.id ?? null, error: r.error ?? null, updated_at: new Date().toISOString() }).eq("id", id);
  return { status: r.status, channel, id, error: r.error };
}
