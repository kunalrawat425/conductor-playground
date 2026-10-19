/**
 * Server-side Meta events (Conversions API), so Meta sees them even when the buyer's tab closed or the
 * pixel was blocked. Every event carries the same event_id the browser pixel used for it, so Meta
 * counts one event when both arrive:
 *  - Purchase: once when a Razorpay payment settles an order (same hook as the GA purchase in ga-mp.ts).
 *    event_id = Razorpay order id, the eventID of the pixel's Purchase on /track.
 *    The browser's _fbp/_fbc cookies go into the Razorpay order notes at creation (razorpay-create-order.ts).
 *  - InitiateCheckout: when the cart is placed (create-seller-cart.ts), with the eventID the seller page's
 *    pixel used when checkout opened.
 *  - AddToCart / ViewContent: the cart lives in the browser, so the seller page beacons them to
 *    /api/meta/event with the pixel's eventID.
 * IP and user agent are never stored: they are passed in memory only from the buyer's own request;
 * webhook and cron sends go without them.
 * Off unless META_CAPI_TOKEN is set (set it on Vercel production only, so stage never reports). Never throws.
 */
import { cookieJar, rzpGet } from "./ga-mp";
import { SITE_URL } from "../brand";

const PIXEL_ID = "1197248829088195";
const GRAPH = "https://graph.facebook.com/v23.0";

export type MetaClient = { ip?: string; ua?: string };

export type MetaEventData = {
  value?: number;
  currency?: string;
  contents?: { id: string; quantity: number }[];
  fbp?: string;
  fbc?: string;
  ip?: string;
  ua?: string;
  event_source_url?: string;
};

/** Razorpay order notes (values max 256 chars) with the buyer's Meta cookie ids. */
export function metaNotesFromRequest(request: Request): Record<string, string> {
  const jar = cookieJar(request.headers.get("cookie"));
  const fbp = jar.get("_fbp")?.slice(0, 255);
  const fbc = jar.get("_fbc")?.slice(0, 255);
  return { ...(fbp ? { fbp } : {}), ...(fbc ? { fbc } : {}) };
}

/** The buyer's IP and user agent from their own request. Held in memory for one CAPI send, never persisted. */
export function metaClientFromRequest(request: Request): MetaClient {
  return {
    ip: (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || undefined,
    ua: request.headers.get("user-agent") || undefined,
  };
}

/** Cookie ids + IP/UA of the buyer's own request, ready to spread into MetaEventData. */
export function metaUserFromRequest(request: Request): Pick<MetaEventData, "fbp" | "fbc" | "ip" | "ua"> {
  return { ...metaNotesFromRequest(request), ...metaClientFromRequest(request) };
}

/**
 * One CAPI event. fbp, fbc, IP and user agent go in unhashed, as Meta requires (only PII such as
 * email or phone is hashed, and we send none). Unknown keys are left out.
 */
export function metaEventPayload(name: string, eventId: string, d: MetaEventData, now = Date.now()) {
  return {
    event_name: name,
    event_time: Math.floor(now / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: d.event_source_url || SITE_URL,
    user_data: {
      ...(d.fbp ? { fbp: d.fbp } : {}),
      ...(d.fbc ? { fbc: d.fbc } : {}),
      ...(d.ip ? { client_ip_address: d.ip } : {}),
      ...(d.ua ? { client_user_agent: d.ua } : {}),
    },
    custom_data: {
      value: d.value ?? 0,
      currency: d.currency || "INR",
      ...(d.contents?.length ? { contents: d.contents, content_type: "product" } : {}),
    },
  };
}

/** Send one event to the pixel. Off without META_CAPI_TOKEN. Never throws. */
export async function metaEvent(name: string, eventId: string, d: MetaEventData): Promise<void> {
  const token = import.meta.env.META_CAPI_TOKEN || "";
  if (!token || !eventId) return;
  try {
    const res = await fetch(`${GRAPH}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [metaEventPayload(name, eventId, d)] }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) console.warn("[meta-capi] events failed", name, res.status);
  } catch (err: any) {
    console.warn("[meta-capi] events error", name, err?.message);
  }
}

/** `Purchase` for one settled Razorpay order. Call exactly once per order (on the paid transition). */
export async function metaPurchase(razorpayOrderId: string, client?: MetaClient): Promise<void> {
  if (!import.meta.env.META_CAPI_TOKEN) return;
  const ro = await rzpGet(`orders/${razorpayOrderId}`);
  if (!ro?.amount) return;
  const n = ro.notes || {};
  await metaEvent("Purchase", razorpayOrderId, {
    value: Number(ro.amount) / 100,
    fbp: n.fbp,
    fbc: n.fbc,
    ip: client?.ip,
    ua: client?.ua,
    event_source_url: `${SITE_URL}/track`,
  });
}
