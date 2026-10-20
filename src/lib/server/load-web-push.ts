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
  return api;
}

/**
 * Deliver now, not when the phone next wakes: without `urgency: "high"` Android
 * batches web pushes while in Doze, so an order alert or a 6–10 PM pre-order
 * nudge can arrive minutes late. TTL 24h: a stale fish alert is useless.
 */
export const PUSH_SEND_OPTIONS = { urgency: "high", TTL: 86400 } as const;

