import { cleanSellerName, sellerHref, stripContactInfo } from "./seller-display";
import { getSpeciesDisplay } from "./species";

export interface CrawlSeller { name: string; href: string; location: string; species: { name: string; href: string | null }[] }

/** Server-rendered seller list for crawlers: only sellers with at least one available listing. */
export function buildCrawlSellers(
  sellers: { id: string; name: string; location_name?: string | null }[],
  listings: { seller_id: string; species: string }[],
): CrawlSeller[] {
  const speciesBySeller = new Map<string, Set<string>>();
  for (const l of listings) {
    if (!speciesBySeller.has(l.seller_id)) speciesBySeller.set(l.seller_id, new Set());
    speciesBySeller.get(l.seller_id)!.add(l.species);
  }
  return sellers
    .filter((s) => speciesBySeller.has(s.id))
    .map((s) => ({ s, href: sellerHref(s.name, s.id) }))
    .map(({ s, href }) => ({
      name: cleanSellerName(s.name),
      href,
      location: stripContactInfo(s.location_name) || "",
      species: [...speciesBySeller.get(s.id)!].map((sp) => ({
        name: getSpeciesDisplay(sp),
        href: href.startsWith("/s/") ? `${href}/${sp.toLowerCase()}` : null, // fish page only under /s/<slug>
      })),
    }));
}
