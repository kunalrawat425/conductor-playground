/**
 * web-push is CommonJS. Vite/Astro may expose it as `import()` namespace, as
 * `namespace.default`, or with APIs on the namespace root — otherwise
 * setVapidDetails is not a function.
 */
export type WebPushApi = {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: unknown,
    payload?: string | Buffer | null,
    options?: unknown
  ): Promise<unknown>;
};

function isWebPushApi(x: unknown): x is WebPushApi {
  return (
    !!x &&
    typeof (x as WebPushApi).setVapidDetails === "function" &&
    typeof (x as WebPushApi).sendNotification === "function"
  );
}

function pickWebPushApi(mod: unknown): WebPushApi | null {
  if (isWebPushApi(mod)) return mod;
  const m = mod as { default?: unknown } | null;
  if (isWebPushApi(m?.default)) return m.default;
  const d = m?.default as { default?: unknown } | undefined;
  if (isWebPushApi(d?.default)) return d.default;
  return null;
}

export async function loadWebPush(): Promise<WebPushApi> {
  const mod: unknown = await import("web-push");
  const api = pickWebPushApi(mod);
  if (!api) {
    const keys = mod && typeof mod === "object" ? Object.keys(mod as object).join(", ") : String(mod);
    console.error("web-push module keys:", keys);
    throw new Error("web-push: could not resolve setVapidDetails (bundler interop)");
  }
  return withExpo(api);
}

/**
 * The Relifish apps (mobile/) save `{ endpoint: EXPO_PUSH_URL, expo: "ExponentPushToken[…]" }` as the
 * push subscription, so every existing `subscription.endpoint` check and sender works unchanged:
 * an Expo subscription goes to Expo's push service, a browser one to web-push as before.
 * Errors look like web-push's: a token the phone no longer has (DeviceNotRegistered) is statusCode 410,
 * so push-error-classify clears it exactly like an expired browser subscription.
 */
export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export function withExpo(api: WebPushApi, fetchImpl: typeof fetch = fetch): WebPushApi {
  return {
    setVapidDetails: (...a) => api.setVapidDetails(...a),
    async sendNotification(subscription, payload, options) {
      const token = (subscription as { expo?: unknown } | null)?.expo;
      if (typeof token !== "string" || !token) return api.sendNotification(subscription, payload, options);
      let msg: Record<string, any> = {};
      try { msg = typeof payload === "string" ? JSON.parse(payload) : {}; } catch { msg = { body: String(payload) }; }
      const { title, body, url, image, tag } = msg;
      const res = await fetchImpl(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          to: token, title, body, sound: "default", priority: "high", channelId: "orders",
          ttl: (options as { TTL?: number } | undefined)?.TTL ?? PUSH_SEND_OPTIONS.TTL,
          data: { url, tag, ...(image ? { image } : {}) },
          ...(image ? { richContent: { image } } : {}),
        }),
      });
      const out: any = await res.json().catch(() => ({}));
      const ticket = Array.isArray(out?.data) ? out.data[0] : out?.data;
      if (!res.ok || ticket?.status === "error" || out?.errors?.length) {
        const code = ticket?.details?.error || out?.errors?.[0]?.code || "";
        const err: any = new Error(`expo push: ${ticket?.message || out?.errors?.[0]?.message || res.status} ${code}`.trim());
        err.statusCode = code === "DeviceNotRegistered" ? 410 : res.ok ? 400 : res.status;
        throw err;
      }
      return ticket;
    },
  };
}

/**
 * Deliver now, not when the phone next wakes: without `urgency: "high"` Android
 * batches web pushes while in Doze, so an order alert or a 6–10 PM pre-order
 * nudge can arrive minutes late. TTL 24h: a stale fish alert is useless.
 */
export const PUSH_SEND_OPTIONS = { urgency: "high", TTL: 86400 } as const;

