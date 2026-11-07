/**
 * Firebase Cloud Messaging (HTTP v1) for the Relifish and Relifish Partner apps. An app saves its push subscription as
 * { endpoint: "fcm", fcm: <device token> } (mobile/src/push.ts); loadWebPush() routes those here, so every existing
 * sender (buyer order updates, seller alerts, reminders, custom pushes) reaches the apps unchanged.
 * Env: FCM_SERVICE_ACCOUNT = the Firebase service-account JSON (project "relifish").
 * A seller order that needs action (tag seller-new_order / payment_confirmed / pay_on_delivery) goes data-only so the
 * Partner app rings full-screen (mobile/src/ring.ts); everything else is a normal notification with the fish photo.
 */
import { createSign } from "node:crypto";
import { resizedImageUrl } from "../seller-display";

type Sa = { project_id: string; client_email: string; private_key: string };
let token: { value: string; exp: number } | null = null;

const b64 = (x: string | Buffer) => Buffer.from(x).toString("base64url");
function account(): Sa {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) throw Object.assign(new Error("FCM_SERVICE_ACCOUNT not set"), { statusCode: 500 });
  return JSON.parse(raw);
}
async function accessToken(sa: Sa): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claim}`).sign(sa.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }),
  });
  const j: any = await r.json();
  if (!r.ok) throw Object.assign(new Error(`FCM auth: ${j.error_description || r.status}`), { statusCode: 500 });
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

const RING = /^seller-(new_order|payment_confirmed|pay_on_delivery)-/;
/** The FCM message for one web-push style payload ({ title, body, url, image?, tag? }). Exported for the self-check. */
export function fcmMessage(deviceToken: string, payload: string) {
  const p = JSON.parse(payload || "{}");
  // Android drops a notification image over 1 MB; fish photos are often 2+ MB originals, so send a 400 px copy.
  if (p.image) p.image = resizedImageUrl(p.image, 400);
  const str = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
  const order = /\/(?:track|orders?)\/([0-9a-f-]{36})/i.exec(p.url || "")?.[1];
  if (RING.test(p.tag || "")) {
    const d = { kind: "new_order", order_id: order, title: p.title, body: p.body, url: p.url, image: p.image };
    // Only kind + dataString: a data message with title/body keys is shown by expo-notifications as a plain
    // notification and the ring task (mobile/src/ring.ts) never runs.
    return { token: deviceToken, data: { kind: "new_order", dataString: JSON.stringify(d) }, android: { priority: "HIGH", ttl: "86400s" } };
  }
  // Android: data-only, drawn by the app (mobile/src/ring.ts showRich) with the photo and Track order / Call us buttons.
  // iOS: a normal alert with the photo (APNs mutable-content + fcm_options.image).
  const d = { kind: "update", title: p.title, body: p.body, url: p.url, image: p.image, tag: p.tag, order_id: order };
  return {
    token: deviceToken,
    data: { kind: "update", dataString: JSON.stringify(d) },
    android: { priority: "HIGH", ttl: "86400s" },
    apns: { payload: { aps: { alert: { title: p.title, body: p.body }, sound: "default", "mutable-content": 1 } }, ...(p.image ? { fcm_options: { image: p.image } } : {}) },
  };
}

/** Same contract as web-push's sendNotification: throws { statusCode: 410 } for a dead token so callers drop it. */
export async function sendFcm(deviceToken: string, payload: string) {
  const sa = account();
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST", headers: { Authorization: `Bearer ${await accessToken(sa)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: fcmMessage(deviceToken, payload) }),
  });
  if (r.ok) return r.json();
  const j: any = await r.json().catch(() => ({}));
  const dead = r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(JSON.stringify(j));
  throw Object.assign(new Error(`FCM ${r.status}: ${j.error?.message || ""}`), { statusCode: dead ? 410 : r.status });
}
