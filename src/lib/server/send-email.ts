// process.env fallback kept for the Node-run QA scripts, which import server
// modules outside the Astro/Vite env pipeline.
const resendApiKey = import.meta.env?.RESEND_API_KEY || process.env.RESEND_API_KEY || "";

/** Sending domain. Its DKIM + send records must be at Hostinger and verified in Resend. */
export const MAIL_DOMAIN = "relifish.com";
export const MAIL_FROM = `Relifish <noreply@${MAIL_DOMAIN}>`;
/** Verified in Resend since April. Used when Resend refuses MAIL_DOMAIN as unverified
 * (relifish.com showed "Failed" from 9 Oct, so every order email bounced at the API). */
export const MAIL_FROM_FALLBACK = "Relifish <noreply@relifish.store>";

/**
 * POST one email to Resend from MAIL_FROM; if Resend answers 403 "domain is not verified",
 * send it again from MAIL_FROM_FALLBACK. Every send goes through here.
 */
export async function postToResend(email: { to: string; subject: string; html: string }, apiKey = resendApiKey): Promise<Response> {
  const post = (from: string) =>
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, ...email }),
    });
  const res = await post(MAIL_FROM);
  if (res.status !== 403) return res;
  const body = await res.clone().text().catch(() => "");
  if (!/domain/i.test(body) || !/verif/i.test(body)) return res;
  console.warn(`[email] ${MAIL_DOMAIN} not verified in Resend; sending from the fallback`, { to: email.to });
  return post(MAIL_FROM_FALLBACK);
}

/**
 * Single entry point for transactional email.
 *
 * Two failure classes this consolidates away:
 *
 * BUG-24 — call sites used raw `fetch(...).catch(() => {})` and never checked
 * `res.ok`. Resend answers 4xx for an unverified domain, a bad recipient or a
 * quota trip; those replies were dropped on the floor, so "the email never
 * arrived" was invisible in logs.
 *
 * BUG-27 — those same sends were fire-and-forget, not awaited. On Vercel the
 * function is frozen as soon as the response is returned, so an in-flight
 * Resend request is simply killed. Order-placed mail was being lost by design.
 * Callers must now await this (see the awaited Promise.allSettled blocks in
 * /api/orders/create).
 *
 * Never throws — returns a status string for logging.
 */
export async function sendTransactionalEmail(
  to: string | null | undefined,
  subject: string,
  html: string,
  tag = "email"
): Promise<string> {
  if (!resendApiKey) return "skipped: no RESEND_API_KEY";
  if (!to || !to.includes("@")) return "skipped: no address";
  try {
    const res = await postToResend({ to, subject, html });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[email:${tag}] resend ${res.status}`, { to, subject, body: body.slice(0, 300) });
      return `failed: resend ${res.status}`;
    }
    return "sent";
  } catch (err: any) {
    console.warn(`[email:${tag}] resend threw`, { to, subject, err: err?.message });
    return `failed: ${err?.message || "unknown"}`;
  }
}
