import { cleanSellerName, sellerHref, stripContactInfo } from "./seller-display";
import { getSpeciesDisplay } from "./species";

export interface CrawlSeller { name: string; href: string; location: string; species: string[] }

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
    .map((s) => ({
      name: cleanSellerName(s.name),
      href: sellerHref(s.name, s.id),
      location: stripContactInfo(s.location_name) || "",
      species: [...speciesBySeller.get(s.id)!].map(getSpeciesDisplay),
    }));
}
