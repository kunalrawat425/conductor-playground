import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import vercelJson from "../../vercel.json";

// Vercel's own source->regex conversion (transitive dep of @astrojs/vercel).
const { getTransformedRoutes } = createRequire(import.meta.url)("@vercel/routing-utils");

describe("apex -> www redirect (vercel.json)", () => {
  const { routes } = getTransformedRoutes({ redirects: vercelJson.redirects });
  const r = routes[0];
  const re = new RegExp(r.src);

  it("is a permanent 308 on the bare apex host only", () => {
    expect(r.status).toBe(308);
    expect(r.has).toEqual([{ type: "host", value: "relifish.store" }]);
  });

  it("keeps the path and skips /api/* (POSTs must not be redirected)", () => {
    expect("/s/ram-fish".replace(re, r.headers.Location)).toBe("https://www.relifish.store/s/ram-fish");
    expect(re.test("/")).toBe(true);
    expect(re.test("/api/orders/create-seller-cart")).toBe(false);
    expect(re.test("/api/payments/razorpay-webhook")).toBe(false);
  });
});

describe("removed blog posts redirect (vercel.json)", () => {
  const { routes } = getTransformedRoutes({ redirects: vercelJson.redirects });
  const hit = (path: string) => routes.slice(1).find((r: any) => new RegExp(r.src).test(path));

  it("sends old URLs, with or without a trailing slash, to a live page with a 308", () => {
    for (const p of ["/blog/where-does-your-sunday-surmai-actually-come-from", "/blog/where-does-your-sunday-surmai-actually-come-from/"]) {
      expect(hit(p)?.status).toBe(308);
      expect(hit(p)?.headers.Location).toBe("/fish/surmai");
    }
    expect(hit("/blog/first-relifish-order-guide-thane")).toBeUndefined();
  });
});

describe("absolute links in emails/push use the www origin", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("production -> https://www.relifish.store (no apex redirect hop)", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const { absoluteUrl } = await import("../../src/lib/server/site-origin");
    expect(absoluteUrl("/track/abc")).toBe("https://www.relifish.store/track/abc");
  });
});
