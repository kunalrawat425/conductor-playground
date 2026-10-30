/**
 * Delivered / read / failed for our WhatsApp messages, read back from Wati (founder, 30 Oct).
 * Wati's send response has no message id and Meta reports blocks later, so the messaging cron
 * polls Wati's per-contact message list and updates message_log (forward only:
 * sent → delivered → read; failed is final, with Wati's reason in `error`).
 * updated_at doubles as "last checked", so each run checks the least recently checked rows first.
 */
import { waNumber } from "./whatsapp";

const env = (k: string) => ((import.meta as any).env?.[k] ?? process.env[k] ?? "") as string;
const RANK: Record<string, number> = { queued: 0, dry_run: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
const STATUS: Record<string, string> = { SENT: "sent", DELIVERED: "delivered", READ: "read", FAILED: "failed" };

/** Wati's message for one of our rows (pure; tested): the first broadcast of the same template
 *  (any of rfw_/rfw2_/rfwt_, incl. the _u utility copy) created after our row (we insert the row,
 *  then call Wati; 10 s for clock skew), not already claimed by another row. */
export function matchWatiItem(items: any[], template: string, sinceIso: string, used: Set<string> = new Set()): any | null {
  const base = String(template).replace(/^rf2?_/, "");
  const re = new RegExp(`"rfw[2t]?_${base}(_u)?"`);
  const since = Date.parse(sinceIso) - 10_000;
  return items
    .filter((x) => x?.eventType === "broadcastMessage" && !used.has(x.id) && re.test(String(x.eventDescription || "")) && Date.parse(x.created) >= since)
    .sort((a, b) => Date.parse(a.created) - Date.parse(b.created))[0] ?? null;
}

/** The row's new status from Wati's item, or null when it would not move forward. */
export function nextStatus(current: string, item: any): string | null {
  const s = STATUS[String(item?.statusString || "").toUpperCase()];
  return s && (RANK[s] ?? -1) > (RANK[current] ?? -1) ? s : null;
}

/** Check up to `limit` recent WhatsApp rows; returns the rows that just turned failed. */
export async function syncWatiStatuses(sb: any, nowMs = Date.now(), limit = 30): Promise<{ checked: number; updated: number; failed: any[] }> {
  const out = { checked: 0, updated: 0, failed: [] as any[] };
  const base = env("WATI_API_URL").replace(/\/$/, "");
  if (env("WA_PROVIDER") !== "wati" || !base || !env("WATI_API_KEY")) return out;
  const { data: rows } = await sb.from("message_log")
    .select("id, dedupe_key, kind, channel, template, to_phone, slot_date, status, provider_id, buyer_id, seller_id, order_id, link_path, payload, created_at, updated_at")
    .eq("channel", "whatsapp").in("status", ["sent", "delivered"])
    .gte("created_at", new Date(nowMs - 48 * 3_600_000).toISOString())
    .order("updated_at", { ascending: true }).limit(limit);
  const byPhone = new Map<string, any[]>();
  for (const r of rows || []) { const p = waNumber(r.to_phone); if (p) byPhone.set(p, [...(byPhone.get(p) || []), r]); }
  for (const [phone, mine] of byPhone) {
    let items: any[] = [];
    try {
      const res = await fetch(`${base}/api/v1/getMessages/${phone}?pageSize=40&pageNumber=1`, { headers: { Authorization: `Bearer ${env("WATI_API_KEY").replace(/^Bearer\s+/i, "")}` } });
      items = (await res.json().catch(() => ({})))?.messages?.items ?? [];
    } catch { continue; }
    // Oldest row first; each Wati item belongs to one row (items already matched earlier are claimed).
    const used = new Set<string>(mine.map((r: any) => r.provider_id).filter(Boolean));
    for (const r of [...mine].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      out.checked++;
      const own = r.provider_id ? items.find((x) => x.id === r.provider_id) : null;
      const item = own || matchWatiItem(items, r.template, r.created_at, used);
      if (item?.id) used.add(item.id);
      const s = item ? nextStatus(r.status, item) : null;
      const patch: any = { updated_at: new Date(nowMs).toISOString(), ...(item?.id ? { provider_id: item.id } : {}) };
      if (s) {
        Object.assign(patch, { status: s, error: s === "failed" ? String(item.failedDetail || "failed").slice(0, 300) : null });
        out.updated++;
        if (s === "failed") out.failed.push({ ...r, status: "failed", error: patch.error });
      }
      await sb.from("message_log").update(patch).eq("id", r.id);
    }
  }
  return out;
}
