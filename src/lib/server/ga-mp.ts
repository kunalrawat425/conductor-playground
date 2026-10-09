/**
 * Server-side GA4 events (Measurement Protocol) for money events, so Analytics matches the database:
 *  - `purchase` once, when a Razorpay payment settles an order (webhook, verify, cron — whichever wins),
 *    even if the buyer closed the tab before the browser could report it;
 *  - `refund` whenever we refund a payment that was reported as a purchase.
 * transaction_id = Razorpay order id (one per checkout). The browser's GA client/session ids are put
 * in the Razorpay order notes at creation, so the server purchase joins the buyer's session and keeps
 * its source/campaign.
 * Off unless GA4_API_SECRET is set (set it on Vercel production only, so stage never reports). Never throws.
 */
const MEASUREMENT_ID = "G-7MXZDZ1S4N"; // GA4 property 539604989
const STREAM_SUFFIX = MEASUREMENT_ID.slice(2); // cookie _ga_7MXZDZ1S4N

export type GaIds = { cid?: string; sid?: string };

/** Client id from `_ga` (GA1.1.<cid>) and session id from `_ga_<stream>` (GS1.1.<sid>. or GS2.1.s<sid>$). */
export function gaIdsFromCookies(cookieHeader: string | null | undefined): GaIds {
  const jar = new Map<string, string>();
  for (const part of (cookieHeader || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) jar.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
  }
  const ga = jar.get("_ga")?.match(/^GA\d\.\d\.(\d+\.\d+)$/)?.[1];
  const sess = jar.get(`_ga_${STREAM_SUFFIX}`);
  const sid = sess?.match(/^GS\d\.\d\.s?(\d+)/)?.[1];
  return { ...(ga ? { cid: ga } : {}), ...(sid ? { sid } : {}) };
}

function rzpAuth(): string | null {
  const id = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
  const secret = import.meta.env.RAZORPAY_KEY_SECRET || "";
  return id && secret ? `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` : null;
}

async function rzpGet(path: string): Promise<any | null> {
  const auth = rzpAuth();
  if (!auth) return null;
  try {
    const res = await fetch(`https://api.razorpay.com/v1/${path}`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(4000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** GA4 needs a client id; without the browser's, use a stable one per checkout (counted as its own user). */
export function gaPayload(ids: GaIds, fallbackKey: string, name: "purchase" | "refund", params: Record<string, unknown>) {
  return {
    client_id: ids.cid || `server.${fallbackKey}`,
    non_personalized_ads: true,
    events: [{ name, params: { ...params, ...(ids.sid ? { session_id: ids.sid, engagement_time_msec: 1 } : {}) } }],
  };
}

async function send(body: unknown): Promise<void> {
  const secret = import.meta.env.GA4_API_SECRET || "";
  if (!secret) return;
  try {
    const res = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${encodeURIComponent(secret)}`,
      { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) console.warn("[ga-mp] collect failed", res.status);
  } catch (err: any) {
    console.warn("[ga-mp] collect error", err?.message);
  }
}

/** `purchase` for one settled Razorpay order. Call exactly once per order (on the paid transition). */
export async function gaPurchase(razorpayOrderId: string, ctx: { order_id: string; seller_id?: string | null }): Promise<void> {
  if (!import.meta.env.GA4_API_SECRET) return;
  const ro = await rzpGet(`orders/${razorpayOrderId}`);
  if (!ro?.amount) return;
  await send(gaPayload({ cid: ro.notes?.ga_cid, sid: ro.notes?.ga_sid }, razorpayOrderId, "purchase", {
    transaction_id: razorpayOrderId,
    value: Number(ro.amount) / 100,
    currency: "INR",
    order_id: ctx.order_id,
    ...(ctx.seller_id ? { seller_id: ctx.seller_id } : {}),
  }));
}

/** `refund` for a Razorpay refund on a payment (full when amountPaise is omitted). */
export async function gaRefund(razorpayPaymentId: string, amountPaise?: number): Promise<void> {
  if (!import.meta.env.GA4_API_SECRET) return;
  const p = await rzpGet(`payments/${razorpayPaymentId}`);
  if (!p?.order_id) return;
  const ro = await rzpGet(`orders/${p.order_id}`);
  await send(gaPayload({ cid: ro?.notes?.ga_cid, sid: ro?.notes?.ga_sid }, p.order_id, "refund", {
    transaction_id: p.order_id,
    value: Number(amountPaise && amountPaise > 0 ? amountPaise : p.amount) / 100,
    currency: "INR",
  }));
}
