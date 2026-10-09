import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import vercelJson from "../../vercel.json";

// Vercel's own source->regex conversion (transitive dep of @astrojs/vercel).
const { getTransformedRoutes } = createRequire(import.meta.url)("@vercel/routing-utils");

describe("old hosts -> www.relifish.com redirect (vercel.json)", () => {
  const { routes } = getTransformedRoutes({ redirects: vercelJson.redirects });
  const r = routes[0];
  const re = new RegExp(r.src);

  it("is a permanent 308 for relifish.store, www.relifish.store and the relifish.com apex", () => {
    expect(r.status).toBe(308);
    expect(routes.slice(0, 3).map((x: any) => x.has[0].value)).toEqual(["relifish.store", "www.relifish.store", "relifish.com"]);
    expect(routes.slice(0, 3).every((x: any) => x.status === 308 && x.src === r.src)).toBe(true);
  });

  it("keeps the path and skips /api/* (POSTs must not be redirected)", () => {
    expect("/s/ram-fish".replace(re, r.headers.Location)).toBe("https://www.relifish.com/s/ram-fish");
    expect(re.test("/")).toBe(true);
    expect(re.test("/api/orders/create-seller-cart")).toBe(false);
    expect(re.test("/api/payments/razorpay-webhook")).toBe(false);
  });
});

describe("removed blog posts redirect (vercel.json)", () => {
  const { routes } = getTransformedRoutes({ redirects: vercelJson.redirects });
  const hit = (path: string) => routes.slice(3).find((r: any) => new RegExp(r.src).test(path));

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
  it("production -> https://www.relifish.com (no redirect hop)", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const { absoluteUrl } = await import("../../src/lib/server/site-origin");
    expect(absoluteUrl("/track/abc")).toBe("https://www.relifish.com/track/abc");
  });
});
