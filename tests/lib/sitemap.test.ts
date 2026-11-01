import { describe, expect, it, vi } from "vitest";

// Thenable query chain: every builder method returns the chain, awaiting it yields the table's rows.
const rows: Record<string, unknown[]> = {
  sellers: [{ id: "s1", name: "Fishtokri", lat: 19.2, lng: 72.97, location: "Thane", location_name: "Thane" }],
  fish_listings: [{ seller_id: "s1", species: "Kupa (Tuna)", pricing_options: [{ price: 100 }] }],
};
const chain = (table: string): any =>
  new Proxy({}, { get: (_, k) => (k === "then" ? (r: any) => r({ data: rows[table], error: null }) : () => chain(table)) });
vi.mock("../../src/lib/supabase", () => ({ supabase: { from: chain } }));
// Vitest has no Astro markdown plugin, so the .md glob is stubbed (the real list is checked by astro build).
vi.mock("../../src/lib/blog-posts", () => ({ BLOG_POSTS: [{ path: "/blog/how-to-clean-pomfret", title: "t", description: "d", lastmod: "2026-10-09" }] }));
const { GET } = await import("../../src/pages/sitemap.xml");

describe("/sitemap.xml", async () => {
  const xml = await (await GET({} as any) as Response).text();

  it("lists /blog and every post with its frontmatter date, never today's date for static pages", () => {
    expect(xml).toContain("<loc>https://www.relifish.com/blog</loc>");
    expect(xml).toMatch(/<loc>https:\/\/www\.relifish\.com\/blog\/how-to-clean-pomfret<\/loc>\n    <lastmod>2026-10-09<\/lastmod>/);
    expect(xml).toMatch(/<loc>https:\/\/www\.relifish\.com\/shop<\/loc>\n  <\/url>/);
  });

  it("percent-encodes item paths like the page canonical and drops priority/changefreq", () => {
    expect(xml).toContain("/s/fishtokri/kupa%20(tuna)</loc>");
    expect(xml).not.toMatch(/<loc>[^<]* [^<]*<\/loc>/);
    expect(xml).not.toContain("changefreq");
    expect(xml).not.toContain("priority");
  });
});
