import type { APIRoute } from "astro";
import { supabase } from "../lib/supabase";
import { cleanSellerName, sellerHref } from "../lib/seller-display";
import { SPECIES } from "../lib/species";
import { SITE_URL } from "../lib/brand";
import { areaNameForPoint } from "../lib/areas";
import { optionBundleAmount, formatBuyerMenuUnitSuffix, getListingPriceOptions } from "../lib/listing-pricing";
import { listingAvailability, sellerDeliveryFee } from "../lib/product-offer";
import { preorderDeliveryDateIST } from "../lib/order-timing";

export const prerender = false;

/**
 * Google Merchant Center product feed (free listings / Shopping). One item per price option of
 * every active seller's fish, linking to the single-fish page that shows the same price without
 * login. Price = the seller's latest regular price (never the pre-order range).
 * Add in Merchant Center as a scheduled fetch of https://www.relifish.com/merchant-feed.xml (daily).
 */
/** Areas whose sellers go in the feed (areaNameForPoint of the seller's shop). Widen when delivery there is reliable. */
const FEED_AREAS = ["Thane"];
const FEED_AVAILABILITY = { InStock: "in_stock", PreOrder: "preorder", OutOfStock: "out_of_stock" } as const;
const STOCK_PHOTO = new Set(["pomfret", "surmai", "prawns", "bangda", "rawas"]);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const GET: APIRoute = async () => {
  const [sRes, lRes] = await Promise.all([
    supabase.from("sellers").select("id, name, lat, lng, location_name, is_test, has_delivery, delivery_fee_enabled, delivery_fee_type, delivery_fee_amount, delivery_fee_per_km, free_delivery_above, delivery_rad, opens_at, closes_at, accepts_preorder, open_days, preorder_days, preorder_cutoff_time, preorder_opens_at, delivery_days").eq("is_active", true),
    supabase.from("fish_listings").select("id, seller_id, species, fish_size, size_label, description, photo_url, is_available, is_order_paused, is_preorder_enabled, weight_avail, pricing_options").is("deleted_at", null),
  ]);
  if (sRes.error || lRes.error) {
    return new Response("Temporarily unavailable", { status: 503, headers: { "Retry-After": "300", "Cache-Control": "no-store" } });
  }
  // Google can't show AVIF; and a broken photo URL disapproves the item. Check each photo once (HEAD, 3s).
  const okType = /\.(jpe?g|png|webp|gif)(\?|$)/i;
  const photoUrls = [...new Set(((lRes.data ?? []) as any[]).map((l) => l.photo_url).filter((u) => u && okType.test(u)))];
  const photoOk = new Map<string, boolean>(await Promise.all(photoUrls.map(async (u): Promise<[string, boolean]> => {
    try { const r = await fetch(u, { method: "HEAD", signal: AbortSignal.timeout(3000) }); return [u, r.ok && /^image\//.test(r.headers.get("content-type") || "")]; }
    catch { return [u, false]; }
  })));

  const sellers = new Map((sRes.data ?? []).filter((s: any) => !s.is_test).map((s: any) => [s.id, s]));
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const items: string[] = [];
  for (const l of (lRes.data ?? []) as any[]) {
    // Hidden from the menu (neither for sale today nor pre-order) = not offered at all (founder:
    // a seller's list is the whole menu), so it isn't in the feed even as "out of stock".
    if (!l.is_available && !l.is_preorder_enabled) continue;
    const s: any = sellers.get(l.seller_id);
    const base = s && sellerHref(s.name, s.id);
    if (!s || !base?.startsWith("/s/")) continue; // only sellers with a public /s/ page
    const species = String(l.species || "").toLowerCase();
    const area = areaNameForPoint(s.lat, s.lng);
    if (!area || !FEED_AREAS.includes(area)) continue;
    // Same rule as the /s/<slug>/<species> page: seller hours first, then the listing's stock.
    const availability = FEED_AVAILABILITY[listingAvailability(l, s)];
    const seller = cleanSellerName(s.name);
    const image = (l.photo_url && photoOk.get(l.photo_url)) ? l.photo_url : STOCK_PHOTO.has(species) ? `${SITE_URL}/fish/${species}.jpg` : null;
    if (!image) continue; // Google requires a JPEG/PNG/WebP/GIF image that loads
    // Delivery cost shown to Google: the seller's own fee. Per-km sellers: the maximum (radius × rate),
    // so the listing never shows less than a buyer pays; checkout charges the real distance.
    const fee = sellerDeliveryFee(s);
    const freeAbove = Number(s.free_delivery_above || 0);
    const shippingXml = `\n<g:shipping><g:country>IN</g:country><g:service>${s.has_delivery ? "Seller home delivery" : "Pickup from seller"}</g:service><g:price>${fee.toFixed(2)} INR</g:price></g:shipping>`
      + (freeAbove > 0 ? `\n<g:free_shipping_threshold><g:country>IN</g:country><g:price_threshold>${freeAbove.toFixed(2)} INR</g:price_threshold></g:free_shipping_threshold>` : "");
    for (const o of getListingPriceOptions(l) as any[]) {
      const price = Number(o.price) > 0 ? Number(o.price) : Number(o.preorder_price_max) || 0;
      if (!(price > 0)) continue;
      // "Prawns Jumbo, 1 kg – Bombay Sea Food, Tardeo" / "Surmai (Kingfish), 250 g – Fishtokri, Thane"
      const unit = formatBuyerMenuUnitSuffix(o).replace(/^\//, "").replace(/^kg$/, "1 kg").replace(/ grams$/, " g").replace(/^pc$/, "1 piece").replace(/pc$/, " pieces");
      const local = species.charAt(0).toUpperCase() + species.slice(1);
      const english = SPECIES[species]?.english.match(/\(([^)]+)\)/)?.[1];
      const size = l.size_label ? ` ${String(l.size_label).trim()}` : l.fish_size ? ` ${String(l.fish_size).charAt(0).toUpperCase()}${String(l.fish_size).slice(1)}` : "";
      // Cut/description keeps sibling listings (Bombil whole vs fry cut) from sharing one title.
      const fish = `${local}${size}${english ? ` (${english})` : ""}${l.description ? `, ${String(l.description).trim()}` : ""}`;
      const title = (l.size_label ? `${fish} – ${seller}, ${area}` : `${fish}, ${unit} – ${seller}, ${area}`).slice(0, 150);
      const kg = o.unit === "kg" ? optionBundleAmount(o) : null;
      items.push(`<item>
<g:id>${esc(`${l.id}-${o.id ?? "0"}`)}</g:id>
<g:title>${esc(title)}</g:title>
<g:description>${esc(`Fresh ${fish}${l.description ? ` (${String(l.description).trim()})` : ""} from ${seller}, a verified local fish seller in ${area}. Order same-day or pre-order for tomorrow on Relifish; the seller delivers or keeps it ready for pickup.`)}</g:description>
<g:link>${esc(`${SITE_URL}${base}/${species}?opt=${encodeURIComponent(`${l.id}-${o.id ?? "0"}`)}`)}</g:link>
<g:image_link>${esc(image)}</g:image_link>
<g:price>${price.toFixed(2)} INR</g:price>
<g:availability>${availability}</g:availability>${availability === "preorder" ? `\n<g:availability_date>${preorderDeliveryDateIST(s) ?? tomorrow}T08:00+05:30</g:availability_date>` : ""}
<g:condition>new</g:condition>${shippingXml}
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
<title>Relifish: fish from verified local sellers</title>
<link>${SITE_URL}</link>
<description>Live fish prices from verified local sellers in Thane.</description>
${items.join("\n")}
</channel>
</rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=900" } });
};
