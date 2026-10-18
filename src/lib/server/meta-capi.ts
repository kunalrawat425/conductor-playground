/**
 * Server-side Meta `Purchase` (Conversions API), sent once when a Razorpay payment settles an order
 * (same hook as the GA purchase in ga-mp.ts), so Meta sees the sale even when the buyer's tab closed
 * or the pixel was blocked. event_id = Razorpay order id, the same eventID the pixel's Purchase on
 * /track uses, so Meta counts one purchase when both arrive.
 * The browser's _fbp/_fbc cookies, IP and user agent go into the Razorpay order notes at creation
 * (razorpay-create-order.ts) and are matched here.
 * Off unless META_CAPI_TOKEN is set (set it on Vercel production only, so stage never reports). Never throws.
 */
import { cookieJar, rzpGet } from "./ga-mp";
import { SITE_URL } from "../brand";

const PIXEL_ID = "1197248829088195";
const GRAPH = "https://graph.facebook.com/v23.0";

/** Razorpay order notes (values max 256 chars) with the buyer's Meta match keys. */
export function metaNotesFromRequest(request: Request): Record<string, string> {
  const jar = cookieJar(request.headers.get("cookie"));
  const notes: Record<string, string> = {
    fbp: jar.get("_fbp") || "",
    fbc: jar.get("_fbc") || "",
    ip: (request.headers.get("x-forwarded-for") || "").split(",")[0].trim(),
    ua: request.headers.get("user-agent") || "",
  };
  for (const k of Object.keys(notes)) {
    if (notes[k]) notes[k] = notes[k].slice(0, 255);
    else delete notes[k];
  }
  return notes;
}

/** `Purchase` for one settled Razorpay order. Call exactly once per order (on the paid transition). */
export async function metaPurchase(razorpayOrderId: string): Promise<void> {
  const token = import.meta.env.META_CAPI_TOKEN || "";
  if (!token) return;
  const ro = await rzpGet(`orders/${razorpayOrderId}`);
  if (!ro?.amount) return;
  const n = ro.notes || {};
  const event = {
    event_name: "Purchase",
    event_time: Math.floor(Date.now() / 1000),
    event_id: razorpayOrderId,
    action_source: "website",
    event_source_url: `${SITE_URL}/track`,
    user_data: {
      ...(n.fbp ? { fbp: n.fbp } : {}),
      ...(n.fbc ? { fbc: n.fbc } : {}),
      ...(n.ip ? { client_ip_address: n.ip } : {}),
      ...(n.ua ? { client_user_agent: n.ua } : {}),
    },
    custom_data: { value: Number(ro.amount) / 100, currency: "INR" },
  };
  try {
    const res = await fetch(`${GRAPH}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event] }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) console.warn("[meta-capi] events failed", res.status);
  } catch (err: any) {
    console.warn("[meta-capi] events error", err?.message);
  }
}
