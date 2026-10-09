import type { APIRoute } from "astro";
import { supabase } from "../lib/supabase";
import { cleanSellerName, sellerHref } from "../lib/seller-display";
import { SPECIES } from "../lib/species";
import { SITE_URL } from "../lib/brand";
import { areaNameForPoint } from "../lib/areas";
import { optionBundleAmount, formatBuyerMenuUnitSuffix, getListingPriceOptions } from "../lib/listing-pricing";

export const prerender = false;

/**
 * Google Merchant Center product feed (free listings / Shopping). One item per price option of
 * every active seller's fish, linking to the single-fish page that shows the same price without
 * login. Price = the seller's latest regular price (never the pre-order range).
 * Add in Merchant Center as a scheduled fetch of https://www.relifish.com/merchant-feed.xml (daily).
 */
const STOCK_PHOTO = new Set(["pomfret", "surmai", "prawns", "bangda", "rawas"]);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const GET: APIRoute = async () => {
  const [sRes, lRes] = await Promise.all([
    supabase.from("sellers").select("id, name, lat, lng, location_name, is_test").eq("is_active", true),
    supabase.from("fish_listings").select("id, seller_id, species, fish_size, photo_url, is_available, is_order_paused, is_preorder_enabled, weight_avail, pricing_options").is("deleted_at", null),
  ]);
  if (sRes.error || lRes.error) {
    return new Response("Temporarily unavailable", { status: 503, headers: { "Retry-After": "300", "Cache-Control": "no-store" } });
  }
  const sellers = new Map((sRes.data ?? []).filter((s: any) => !s.is_test).map((s: any) => [s.id, s]));
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const items: string[] = [];
  for (const l of (lRes.data ?? []) as any[]) {
    const s: any = sellers.get(l.seller_id);
    const base = s && sellerHref(s.name, s.id);
    if (!s || !base?.startsWith("/s/")) continue; // only sellers with a public /s/ page
    const species = String(l.species || "").toLowerCase();
    const sameDay = l.is_available && !l.is_order_paused && Number(l.weight_avail) > 0;
    const availability = sameDay ? "in_stock" : l.is_preorder_enabled ? "preorder" : "out_of_stock";
    const seller = cleanSellerName(s.name);
    const area = areaNameForPoint(s.lat, s.lng) || "Mumbai";
    const image = l.photo_url || (STOCK_PHOTO.has(species) ? `${SITE_URL}/fish/${species}.jpg` : null);
    if (!image) continue; // Google requires an image
    for (const o of getListingPriceOptions(l) as any[]) {
      const price = Number(o.price) > 0 ? Number(o.price) : Number(o.preorder_price_max) || 0;
      if (!(price > 0)) continue;
      // "Prawns Jumbo, 1 kg – Bombay Sea Food, Tardeo" / "Surmai (Kingfish), 250 g – Fishtokri, Thane"
      const unit = formatBuyerMenuUnitSuffix(o).replace(/^\//, "").replace(/^kg$/, "1 kg").replace(/ grams$/, " g").replace(/^pc$/, "1 piece").replace(/pc$/, " pieces");
      const local = species.charAt(0).toUpperCase() + species.slice(1);
      const english = SPECIES[species]?.english.match(/\(([^)]+)\)/)?.[1];
      const size = l.fish_size ? ` ${String(l.fish_size).charAt(0).toUpperCase()}${String(l.fish_size).slice(1)}` : "";
      const fish = `${local}${size}${english ? ` (${english})` : ""}`;
      const title = `${fish}, ${unit} – ${seller}, ${area}`.slice(0, 150);
      const kg = o.unit === "kg" ? optionBundleAmount(o) : null;
      items.push(`<item>
<g:id>${esc(`${l.id}-${o.id ?? "0"}`)}</g:id>
<g:title>${esc(title)}</g:title>
<g:description>${esc(`Fresh ${fish} from ${seller}, a local fish seller in ${area}. Order same-day or pre-order for tomorrow on Relifish; the seller delivers or keeps it ready for pickup.`)}</g:description>
<g:link>${esc(`${SITE_URL}${base}/${species}`)}</g:link>
<g:image_link>${esc(image)}</g:image_link>
<g:price>${price.toFixed(2)} INR</g:price>
<g:availability>${availability}</g:availability>${availability === "preorder" ? `\n<g:availability_date>${tomorrow}T08:00+05:30</g:availability_date>` : ""}
<g:condition>new</g:condition>
<g:brand>${esc(seller)}</g:brand>
<g:identifier_exists>no</g:identifier_exists>
<g:google_product_category>Food, Beverages &amp; Tobacco &gt; Food Items &gt; Meat, Seafood &amp; Eggs &gt; Seafood</g:google_product_category>${kg ? `\n<g:unit_pricing_measure>${Math.round(kg * 1000)}g</g:unit_pricing_measure>\n<g:unit_pricing_base_measure>1kg</g:unit_pricing_base_measure>` : ""}
<g:item_group_id>${esc(`${s.id}-${species}`)}</g:item_group_id>
</item>`);
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>Relifish: fish from local sellers</title>
<link>${SITE_URL}</link>
<description>Live fish prices from local sellers in Thane, South Mumbai and Navi Mumbai.</description>
${items.join("\n")}
</channel>
</rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=900" } });
};
