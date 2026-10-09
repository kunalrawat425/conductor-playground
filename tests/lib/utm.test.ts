import { describe, expect, it } from "vitest";
import { pickUtm } from "../../src/lib/utm";
import { canonicalFor } from "../../src/lib/brand";

describe("pickUtm", () => {
  it("maps the flyer QR campaign to order columns", () => {
    expect(pickUtm({ source: "offline_qr", medium: "brochure", campaign: "thane", content: "delivery", at: Date.now() })).toEqual({
      utm_source: "offline_qr",
      utm_medium: "brochure",
      utm_campaign: "thane",
      utm_content: "delivery",
    });
  });

  it("drops junk: no source, non-strings, over-long values", () => {
    expect(pickUtm(null)).toBeNull();
    expect(pickUtm("x")).toBeNull();
    expect(pickUtm({ medium: "brochure" })).toBeNull();
    const r = pickUtm({ source: "a".repeat(500), campaign: 42 });
    expect(r?.utm_source).toHaveLength(100);
    expect(r?.utm_campaign).toBeNull();
  });
});

describe("canonicalFor", () => {
  it("one www URL per page, no trailing slash except root", () => {
    expect(canonicalFor("/")).toBe("https://www.relifish.com/");
    expect(canonicalFor("/shop/")).toBe("https://www.relifish.com/shop");
    expect(canonicalFor("/shop")).toBe("https://www.relifish.com/shop");
    expect(canonicalFor("/about//")).toBe("https://www.relifish.com/about");
  });
});

describe("seller links", () => {
  it("slug comes from the raw DB name, not the cleaned display name", async () => {
    const { sellerNameToSlug, cleanSellerName } = await import("../../src/lib/seller-display");
    expect(sellerNameToSlug("Fishtokri.com")).toBe("fishtokri-com"); // what /s/[slug] resolves
    expect(sellerNameToSlug(cleanSellerName("Fishtokri.com"))).not.toBe("fishtokri-com"); // the old bug
  });
});

describe("pickUtm: what the browser actually sends", () => {
  it("treats the empty strings the capture script stores as null", () => {
    // AppShell/LandingLayout store missing params as "" — they must not land in orders as "".
    expect(pickUtm({ source: "offline_qr", medium: "", campaign: "", content: "", at: Date.now() })).toEqual({
      utm_source: "offline_qr",
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
    });
  });

  it("trims, and a whitespace-only source means no attribution", () => {
    expect(pickUtm({ source: "  blog  ", medium: " organic " })).toMatchObject({ utm_source: "blog", utm_medium: "organic" });
    expect(pickUtm({ source: "   " })).toBeNull();
    expect(pickUtm([])).toBeNull();
  });

  it("only ever returns the four utm_* columns (body is spread into orders.update)", () => {
    const r = pickUtm({ source: "x", id: "evil", buyer_id: "b", status: "paid", total_price: 0 });
    expect(Object.keys(r!).sort()).toEqual(["utm_campaign", "utm_content", "utm_medium", "utm_source"]);
  });
});

describe("canonicalFor edge cases", () => {
  it("empty path is the root; nested paths keep their segments", () => {
    expect(canonicalFor("")).toBe("https://www.relifish.com/");
    expect(canonicalFor("/blog/fish-guide/")).toBe("https://www.relifish.com/blog/fish-guide");
    expect(canonicalFor("/s/ram-fish")).toBe("https://www.relifish.com/s/ram-fish");
  });
});

describe("sellerNameToSlug", () => {
  it("collapses punctuation/spaces and trims dashes so /s/[slug] (lowercased) matches", async () => {
    const { sellerNameToSlug } = await import("../../src/lib/seller-display");
    expect(sellerNameToSlug("  Ram's Fish  &  Co. ")).toBe("ram-s-fish-co");
    expect(sellerNameToSlug("RAM FISH")).toBe(sellerNameToSlug("ram fish"));
  });
});

describe("pickUtm attribution window", () => {
  const now = 1_800_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  it("credits a campaign within 30 days of landing", () => {
    expect(pickUtm({ source: "offline_qr", campaign: "thane", at: now - 29 * day }, now)?.utm_campaign).toBe("thane");
  });
  it("drops a stale last-touch older than 30 days", () => {
    expect(pickUtm({ source: "offline_qr", campaign: "thane", at: now - 31 * day }, now)).toBeNull();
  });
  it("accepts payloads without a timestamp (older clients)", () => {
    expect(pickUtm({ source: "blog" }, now)?.utm_source).toBe("blog");
  });
});
