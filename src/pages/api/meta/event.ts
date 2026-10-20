import type { APIRoute } from "astro";
import { metaEvent, metaUserFromRequest } from "../../../lib/server/meta-capi";
import { afterResponse } from "../../../lib/server/after-response";
import { clientKey, overLimit } from "../../../lib/server/rate-limit";

export const prerender = false;

/**
 * POST /api/meta/event — server copy (CAPI) of a browser pixel event that has no server call of its
 * own: the cart lives in the browser. The seller page beacons it with the pixel's eventID so Meta
 * dedupes. Answers 204 at once; the send to Meta runs after the response. Internal devices
 * (rf_internal) never call it. Off without META_CAPI_TOKEN (metaEvent).
 */
const EVENTS = new Set(["AddToCart", "InitiateCheckout", "ViewContent"]);
const SITE_HOSTS = new Set(["relifish.com", "www.relifish.com", "stage.relifish.com"]);

const hostOf = (u: string | null) => { try { return u ? new URL(u).host : ""; } catch { return ""; } };
const clamp = (n: unknown, max: number) => { const v = Number(n); return Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : 0; };

export const POST: APIRoute = async ({ request, url }) => {
  // Same origin only: our domains or this deployment's own host (Vercel preview, localhost).
  const from = hostOf(request.headers.get("origin")) || hostOf(request.headers.get("referer"));
  if (!from || !(SITE_HOSTS.has(from) || from === url.host)) return new Response(null, { status: 403 });
  if (overLimit(`meta-event:${clientKey(request)}`, 120, 60_000)) return new Response(null, { status: 429 });

  let body: any;
  try {
    const text = await request.text();
    if (text.length > 4096) return new Response(null, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const name = body?.event_name;
  const eventId = body?.event_id;
  if (!EVENTS.has(name) || typeof eventId !== "string" || !eventId || eventId.length > 64) {
    return new Response(null, { status: 400 });
  }
  const contents = (Array.isArray(body.contents) ? body.contents : []).slice(0, 20)
    .filter((c: any) => c && (typeof c.id === "string" || typeof c.id === "number"))
    .map((c: any) => ({ id: String(c.id).slice(0, 64), quantity: clamp(c.quantity, 1000) }));

  afterResponse(metaEvent(name, eventId, {
    value: clamp(body.value, 20000),
    contents,
    ...metaUserFromRequest(request),
    event_source_url: request.headers.get("referer")?.slice(0, 500) || undefined,
  }), `meta-capi:${name}`);
  return new Response(null, { status: 204 });
};
