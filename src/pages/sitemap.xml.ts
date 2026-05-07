import type { APIRoute } from "astro";
import { supabase } from "../lib/supabase";

export const prerender = false;

const SITE = "https://www.relifish.store";

export const GET: APIRoute = async () => {
  const today = new Date().toISOString().split("T")[0];

  // Fetch all active sellers
  const { data: sellers } = await supabase
    .from("sellers")
    .select("id, name")
    .order("name");

  // Fetch distinct species from active listings
  const { data: species } = await supabase
    .from("fish_listings")
    .select("species")
    .eq("is_available", true);

  const uniqueSpecies = [...new Set((species || []).map((s) => s.species))];

  const urls: { loc: string; changefreq: string; priority: string }[] = [
    // Use final destination URLs (no 302 chains)
    { loc: "/", changefreq: "daily", priority: "1.0" },
    { loc: "/search", changefreq: "weekly", priority: "0.6" },
    // Static marketing pages
    { loc: "/buyer-detailed.html", changefreq: "monthly", priority: "0.9" },
    { loc: "/seller-detailed.html", changefreq: "monthly", priority: "0.9" },
  ];

  for (const seller of sellers || []) {
    urls.push({
      loc: `/seller/${seller.id}`,
      changefreq: "daily",
      priority: "0.8",
    });
  }

  for (const sp of uniqueSpecies) {
    urls.push({
      loc: `/preorder/${encodeURIComponent(sp)}`,
      changefreq: "daily",
      priority: "0.7",
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
      "Cache-Control": "public, max-age=3600",
    },
  });
};
