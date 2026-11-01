import type { APIRoute } from "astro";
import { supabase } from "../lib/supabase";
import { cleanSellerName, sellerHref, stripContactInfo } from "../lib/seller-display";
import { getSpeciesDisplay, SPECIES } from "../lib/species";
import { hubIndexable } from "../lib/fish-hub";
import { AREAS, areaNameForPoint, sellersForArea } from "../lib/areas";
import { BLOG_POSTS } from "../lib/blog-posts";

export const prerender = false;

const SITE = "https://www.relifish.com";

/**
 * /llms.txt for AI assistants. Generated from the same live data as the sitemap so it never
 * lists inactive sellers, dead URLs or claims we cannot back up (see SOURCE-OF-TRUTH.md).
 */
export const GET: APIRoute = async () => {
  let sellers: { id: string; name: string; location: string | null; location_name: string | null; lat: number | null; lng: number | null }[] = [];
  let fishRows: { seller_id: string; species: string; pricing_options: unknown }[] = [];
  try {
    const [s, f] = await Promise.all([
      supabase.from("sellers").select("id, name, location, location_name, lat, lng").eq("is_active", true).or("is_test.is.null,is_test.eq.false").order("name"),
      supabase.from("fish_listings").select("seller_id, species, pricing_options").is("deleted_at", null),
    ]);
    if (s.error || f.error) throw s.error || f.error;
    sellers = s.data ?? [];
    fishRows = (f.data ?? []) as any;
  } catch {
    // Never publish (or let the CDN cache) an empty "no sellers" file during a DB outage.
    return new Response("Temporarily unavailable", { status: 503, headers: { "Retry-After": "120", "Cache-Control": "no-store" } });
  }

  const active = new Set(sellers.map((s) => s.id));
  const perSpecies = new Map<string, number>();
  const seen = new Set<string>();
  for (const r of fishRows) {
    const sp = String(r.species).toLowerCase();
    if (!active.has(r.seller_id) || !Array.isArray(r.pricing_options) || !r.pricing_options.length) continue;
    if (seen.has(`${r.seller_id}:${sp}`)) continue;
    seen.add(`${r.seller_id}:${sp}`);
    perSpecies.set(sp, (perSpecies.get(sp) || 0) + 1);
  }
  const hubs = [...perSpecies].filter(([sp, n]) => hubIndexable(sp, n) && SPECIES[sp]).map(([sp]) => sp);
  const species = [...perSpecies.keys()].filter((sp) => SPECIES[sp]).map(getSpeciesDisplay);

  // Areas with a live seller (the others are noindex "not yet" pages), and each seller's area as the site shows it (fish hubs, /area pages).
  const areas = Object.entries(AREAS).filter(([, a]) => sellersForArea(a, sellers).length > 0);
  const place = (s: (typeof sellers)[number]) => areaNameForPoint(s.lat, s.lng) || stripContactInfo(s.location_name);

  const body = `# Relifish
# ${SITE}

> Relifish is an online fish marketplace. Independent fish sellers in Mumbai, Thane and Navi Mumbai, each approved by Relifish after a call before going live, list the fish they have each day; buyers order same-day during the seller's opening hours or pre-order tonight for tomorrow. Sellers deliver the order or keep it ready for pickup. Relifish does not catch, store or deliver fish itself.

## Key pages

- [Browse sellers](${SITE}/shop): live seller menus with today's fish and prices
- [Fish price today](${SITE}/fish-price-today): today's fish rates per kg (or per pack) from every live seller listing, with each seller's price
${areas.map(([key, a]) => `- [Fish delivery in ${a.name}](${SITE}/area/${key}): sellers that deliver in ${a.name}, their delivery fees and the localities they cover`).join("\n")}
${hubs.map((sp) => `- [${getSpeciesDisplay(sp)}](${SITE}/fish/${sp}): every seller listing it, with today's price and availability`).join("\n")}
- [Sell on Relifish](${SITE}/for-sellers): for fish sellers
- [About Relifish](${SITE}/about)

## Guides

${BLOG_POSTS.map((p) => `- [${p.title}](${SITE}${p.path}): ${p.description}`).join("\n")}

## Active sellers

${sellers.map((s) => `- [${cleanSellerName(s.name)}](${SITE}${sellerHref(s.name, s.id)})${place(s) ? ` · ${place(s)}` : ""}`).join("\n") || "- None listed right now"}

## Facts

- Order types: same-day (during the seller's opening hours) and pre-order (before the seller's cutoff shown on their page, for the next morning)
- Payment: online through Razorpay when the order is placed; the seller then confirms the order
- Pre-order pricing: the buyer pays the top of a price range; the seller sets the final price from the morning's stock and any difference is refunded
- Refunds: if the seller declines or the buyer cancels before the seller confirms, the full amount is refunded to the original payment method, usually within 5 to 7 working days
- Delivery and pickup: handled by each seller, who sets their own delivery radius, fee and minimum order
- Preparation: buyers choose whole, cleaned or cut, plus a note, at checkout
- Fish sellers list (varies daily): ${species.join(", ") || "varies by seller"}
- Contact: relifishstore@gmail.com · WhatsApp 9152207607 (7:30 AM – 9 PM)
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=3600" } });
};
