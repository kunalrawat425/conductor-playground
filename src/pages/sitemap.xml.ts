import type { APIRoute } from "astro";
import { supabase } from "../lib/supabase";
import { sellerHref } from "../lib/seller-display";
import { hubIndexable } from "../lib/fish-hub";
import { SPECIES } from "../lib/species";
import { AREAS, sellersForArea } from "../lib/areas";
import { canonicalFor } from "../lib/brand";
import { BLOG_POSTS } from "../lib/blog-posts";

export const prerender = false;

/** The only sitemap (the @astrojs/sitemap integration was removed). No priority/changefreq: Google ignores them.
 *  lastmod only where a real change date exists (blog frontmatter); sellers/listings have no updated_at column. */
type Entry = { loc: string; lastmod?: string };

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const blogPosts: Entry[] = BLOG_POSTS.map((p) => ({ loc: p.path, lastmod: p.lastmod }));
const blogLastmod = blogPosts.map((p) => p.lastmod).filter(Boolean).sort().pop();

export const GET: APIRoute = async () => {
  // Fetch all active sellers
  const { data: sellers } = await supabase
    .from("sellers")
    .select("id, name, lat, lng, location, location_name")
    .eq("is_active", true).or("is_test.is.null,is_test.eq.false")
    .order("name");

  const urls: Entry[] = [
    ...["/", "/shop", "/fish-price-today", "/for-sellers", "/about", "/privacy", "/terms", "/refund-policy", "/shipping-policy", "/contact"].map((loc) => ({ loc })),
    { loc: "/blog", lastmod: blogLastmod },
    ...blogPosts,
    // Only areas a live seller serves: the others are noindex ("not yet") pages.
    ...Object.entries(AREAS).filter(([, area]) => sellersForArea(area, sellers ?? []).length > 0).map(([key]) => ({ loc: `/area/${key}` })),
  ];

  // Per-fish product pages (/s/<slug>/<species>) for sellers with a latin slug.
  const { data: fishRows } = await supabase.from("fish_listings").select("seller_id, species, pricing_options").is("deleted_at", null);
  const speciesBySeller = new Map<string, Set<string>>();
  for (const r of fishRows || []) {
    if (!Array.isArray(r.pricing_options) || !r.pricing_options.length) continue; // fish page 404s without a price
    if (!speciesBySeller.has(r.seller_id)) speciesBySeller.set(r.seller_id, new Set());
    speciesBySeller.get(r.seller_id)!.add(String(r.species).toLowerCase());
  }

  // Fish hubs: only those the hub page itself marks indexable (hubIndexable).
  const activeIds = new Set((sellers || []).map((s) => s.id));
  const sellersPerSpecies = new Map<string, number>();
  for (const [sid, set] of speciesBySeller) {
    if (!activeIds.has(sid)) continue;
    for (const sp of set) sellersPerSpecies.set(sp, (sellersPerSpecies.get(sp) || 0) + 1);
  }
  for (const [sp, n] of sellersPerSpecies) {
    if (hubIndexable(sp, n) && SPECIES[sp]) urls.push({ loc: `/fish/${sp}` });
  }

  for (const seller of sellers || []) {
    const path = sellerHref(seller.name, seller.id); // same URL as the seller page canonical
    urls.push({ loc: path });
    if (!path.startsWith("/s/")) continue;
    for (const sp of speciesBySeller.get(seller.id) || []) {
      urls.push({ loc: `${path}/${sp}` });
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  // canonicalFor = the same (percent-encoded) URL as each page's <link rel=canonical>, e.g. "kupa%20(tuna)".
  .map((u) => `  <url>\n    <loc>${xmlEscape(canonicalFor(u.loc))}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ""}\n  </url>`)
  .join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
    },
  });
};
