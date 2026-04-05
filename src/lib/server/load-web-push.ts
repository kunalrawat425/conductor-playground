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
