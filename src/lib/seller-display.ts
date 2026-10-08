const DOMAIN_TLD = "(com|in|net|org|store|shop|co|io|biz|info|fish)";
const DOMAIN_RE = new RegExp(`\\b([\\w-]+)\\.(?:[\\w-]+\\.)?${DOMAIN_TLD}\\b`, "i");
const DOMAIN_STRIP_RE = new RegExp(`(?:www\\.|[\\w-]+\\.)*[\\w-]+\\.${DOMAIN_TLD}\\b`, "gi");

const GENERIC_SUBDOMAINS = new Set(["www", "shop", "store", "mail", "app", "web", "m", "api"]);

/** Strip phone numbers, URLs, and domain names from any display string. */
export function stripContactInfo(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/\b\d{10,}\b/g, "")
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(DOMAIN_STRIP_RE, "")
    .replace(/[·•|,\s]+$/, "").replace(/^[·•|,\s]+/, "")
    .replace(/([·•|])\s*[·•|]/g, "$1")
    .trim();
}

/**
 * Clean a seller name for display.
 * "Fishtokri.com · 9220200100" → "Fishtokri"
 * "Ram Fish · https://wa.me/xxx" → "Ram Fish"
 */
export function cleanSellerName(raw: string | null | undefined): string {
  if (!raw) return "";
  const domainMatch = raw.match(DOMAIN_RE);
  const candidate = domainMatch?.[1];
  const nameBeforeDomain = candidate && !GENERIC_SUBDOMAINS.has(candidate.toLowerCase()) ? candidate : null;
  const cleaned = stripContactInfo(raw);
  if (!cleaned && nameBeforeDomain) {
    return nameBeforeDomain.charAt(0).toUpperCase() + nameBeforeDomain.slice(1).toLowerCase();
  }
  return cleaned;
}

/** URL slug for /s/[slug]. Always derive from the raw DB name — getSellerBySlug matches on it. */
export function sellerNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Link to a seller page; falls back to /seller/<id> when the name has no latin chars (empty slug). */
export function sellerHref(name: string | null | undefined, id: string): string {
  const slug = sellerNameToSlug(name || "");
  return slug ? `/s/${slug}` : `/seller/${id}`;
}

/** Supabase lookup error -> page outcome. PGRST116 = no row, 22P02 = malformed uuid; anything else is an outage. */
export function sellerLookupOutcome(err: unknown): "not_found" | "unavailable" {
  const code = (err as { code?: string } | null)?.code;
  return code === "PGRST116" || code === "22P02" ? "not_found" : "unavailable";
}
