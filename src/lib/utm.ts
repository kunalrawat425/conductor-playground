/** A campaign gets credit for orders up to this long after the buyer landed. */
export const UTM_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Client-supplied UTM → order columns. Untrusted input: strings only, capped length. */
export function pickUtm(raw: unknown, now = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.at === "number" && now - r.at > UTM_MAX_AGE_MS) return null; // stale last-touch
  const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : null);
  const utm_source = clean(r.source);
  if (!utm_source) return null;
  return { utm_source, utm_medium: clean(r.medium), utm_campaign: clean(r.campaign), utm_content: clean(r.content) };
}
