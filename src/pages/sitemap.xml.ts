import type { APIRoute } from "astro";
import { supabase } from "../lib/supabase";
import { sellerHref } from "../lib/seller-display";
import { HUB_MIN_SELLERS } from "../lib/fish-hub";
import { SPECIES } from "../lib/species";
import { AREAS, sellersForArea } from "../lib/areas";

export const prerender = false;

const SITE = "https://www.relifish.com";

export const GET: APIRoute = async () => {
  const today = new Date().toISOString().split("T")[0];

  // Fetch all active sellers
  const { data: sellers } = await supabase
    .from("sellers")
    .select("id, name, lat, lng, location, location_name")
    .eq("is_active", true)
    .order("name");

  // Fetch distinct species from active listings
  const urls: { loc: string; changefreq: string; priority: string }[] = [
    // Core pages
    { loc: "/", changefreq: "daily", priority: "1.0" },
    { loc: "/shop", changefreq: "daily", priority: "0.9" },
    // Marketing pages
    { loc: "/for-sellers", changefreq: "weekly", priority: "0.8" },
    { loc: "/about", changefreq: "monthly", priority: "0.7" },
    { loc: "/privacy", changefreq: "yearly", priority: "0.3" },
    { loc: "/terms", changefreq: "yearly", priority: "0.3" },
    { loc: "/refund-policy", changefreq: "yearly", priority: "0.3" },
    { loc: "/shipping-policy", changefreq: "yearly", priority: "0.3" },
    { loc: "/contact", changefreq: "yearly", priority: "0.4" },
    // Area pages dynamically populated from areas config
    // Only areas a live seller serves: the others are noindex ("not yet") pages.
    ...Object.entries(AREAS).filter(([, area]) => sellersForArea(area, sellers ?? []).length > 0).map(([key]) => ({
      loc: `/area/${key}`,
      changefreq: "weekly",
      priority: "0.7",
    })),
  ];

  // Per-fish product pages (/s/<slug>/<species>) for sellers with a latin slug.
  const { data: fishRows } = await supabase.from("fish_listings").select("seller_id, species, pricing_options");
  const speciesBySeller = new Map<string, Set<string>>();
  for (const r of fishRows || []) {
    if (!Array.isArray(r.pricing_options) || !r.pricing_options.length) continue; // fish page 404s without a price
    if (!speciesBySeller.has(r.seller_id)) speciesBySeller.set(r.seller_id, new Set());
    speciesBySeller.get(r.seller_id)!.add(String(r.species).toLowerCase());
  }

  // Fish hubs: only those the hub page itself marks indexable (>= HUB_MIN_SELLERS active sellers with a price).
  const activeIds = new Set((sellers || []).map((s) => s.id));
  const sellersPerSpecies = new Map<string, number>();
  for (const [sid, set] of speciesBySeller) {
    if (!activeIds.has(sid)) continue;
    for (const sp of set) sellersPerSpecies.set(sp, (sellersPerSpecies.get(sp) || 0) + 1);
  }
  for (const [sp, n] of sellersPerSpecies) {
    if (n >= HUB_MIN_SELLERS && SPECIES[sp]) urls.push({ loc: `/fish/${sp}`, changefreq: "daily", priority: "0.8" });
  }

  for (const seller of sellers || []) {
    const path = sellerHref(seller.name, seller.id); // same URL as the seller page canonical
    urls.push({ loc: path, changefreq: "daily", priority: "0.8" });
    if (!path.startsWith("/s/")) continue;
    for (const sp of speciesBySeller.get(seller.id) || []) {
      urls.push({ loc: `${path}/${sp}`, changefreq: "daily", priority: "0.7" });
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${SITE}${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
    },
  });
};
