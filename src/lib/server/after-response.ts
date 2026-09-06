import { waitUntil } from "@vercel/functions";

/**
 * Run background work that must survive the response.
 *
 * BUG-27 context: order and receipt emails were originally fire-and-forget.
 * On Vercel the function is frozen the instant the response is returned, so an
 * in-flight Resend request is killed — the mail was being dropped whenever
 * Resend was slower than the response.
 *
 * Awaiting fixes delivery but bills the buyer ~200-400ms on the order-placement
 * path, which is the wrong trade on a checkout button. `waitUntil` gives both:
 * the response goes out immediately, and the platform keeps the invocation
 * alive until the promise settles.
 *
 * Outside Vercel (astro dev, QA scripts, tests) `waitUntil` throws because
 * there is no request context. There the process is long-lived anyway, so
 * detaching is safe — we only need to swallow rejections so an email failure
 * never becomes an unhandled rejection that takes the dev server down.
 */
export function afterResponse(work: Promise<unknown>, tag = "after-response"): void {
  const safe = Promise.resolve(work).catch((err: any) => {
    console.warn(`[${tag}] background work failed`, err?.message || err);
  });
  try {
    waitUntil(safe);
  } catch {
    // No Vercel request context — the promise is already detached and guarded.
  }
}
