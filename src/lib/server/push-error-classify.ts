/**
 * Classify a Web Push send failure.
 *
 * BUG-22: previously every failure was treated the same — logged and forgotten.
 * Terminal failures (the endpoint is gone) must clear the stored subscription,
 * otherwise the row keeps a dead endpoint forever and every subsequent push to
 * that user fails silently. Transient failures (429, 5xx, network) must NOT
 * clear it, or one bad minute at the push service unsubscribes real users.
 *
 * Per RFC 8030 / browser push services:
 *   404 Not Found  — endpoint never existed / was deleted
 *   410 Gone       — subscription expired or was revoked by the browser
 * Both are permanent. Everything else is retryable.
 */
export function pushErrorStatus(err: unknown): number {
  const e = err as any;
  const raw = e?.statusCode ?? e?.status ?? e?.response?.status;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function isTerminalPushError(err: unknown): boolean {
  const code = pushErrorStatus(err);
  return code === 404 || code === 410;
}
