import type { APIRoute } from "astro";
import { supabase, sellerNameToSlug } from "../lib/supabase";
import { AREAS } from "../lib/areas";

export const prerender = false;

const SITE = "https://www.relifish.store";

export const GET: APIRoute = async () => {
  const today = new Date().toISOString().split("T")[0];

  // Fetch all active sellers
  const { data: sellers } = await supabase
    .from("sellers")
    .select("id, name")
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
    { loc: "/pricing.md", changefreq: "weekly", priority: "0.5" },
    { loc: "/llms.txt", changefreq: "weekly", priority: "0.5" },
    { loc: "/privacy", changefreq: "yearly", priority: "0.3" },
    { loc: "/terms", changefreq: "yearly", priority: "0.3" },
    { loc: "/refund-policy", changefreq: "yearly", priority: "0.3" },
    // Area pages dynamically populated from areas config
    ...Object.keys(AREAS).map((key) => ({
      loc: `/area/${key}`,
      changefreq: "weekly",
      priority: "0.7",
    })),
  ];

  for (const seller of sellers || []) {
    const slug = sellerNameToSlug(seller.name);
    urls.push({
      loc: `/s/${slug}`,
      changefreq: "daily",
      priority: "0.8",
    });
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
