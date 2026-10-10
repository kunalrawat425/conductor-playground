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

/** Old slug scheme ("Fishtokri.com" -> "fishtokri-com"). Still resolved so old links 308 to the clean slug. */
export function legacySellerSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * URL slug for /s/[slug], from the raw DB name with web-domain suffixes dropped:
 * "Fishtokri.com" -> "fishtokri", "Bombay Sea Food" -> "bombay-sea-food".
 */
export function sellerNameToSlug(name: string): string {
  return legacySellerSlug(name.replace(/\.(co\.in|com|in|store|net|org|shop)\b/gi, ""));
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

/**
 * Business name rule for sellers: 2–60 characters of letters (any script), numbers, spaces and & ' - .
 * No website addresses ("Fishtokri.com", "www…") and no phone numbers. Returns an error message, or null if OK.
 */
export function validateSellerName(raw: unknown): string | null {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 60) return "Business name must be 2 to 60 characters.";
  if (/https?:|www\.|\.[a-z]{2,}(\b|$)/i.test(name)) return "Don't add a website address to your business name (e.g. use \"Fishtokri\", not \"Fishtokri.com\").";
  if (/\d[\d\s-]{6,}\d/.test(name)) return "Don't add a phone number to your business name; buyers contact you through Relifish.";
  if (!/^[\p{L}\p{M}\p{N} &'-]+$/u.test(name)) return "Use only letters, numbers, spaces and & ' - in your business name.";
  return null;
}

/**
 * Supabase Storage photo, resized and served as WebP by Supabase's image transform
 * (fishtokri_banner.png: 2.1 MB → ~30 KB at 800 px); "contain" keeps the aspect ratio (width alone crops). Other URLs are returned unchanged.
 */
export function resizedImageUrl(url: string | null | undefined, width: number): string | null {
  if (!url) return null;
  if (!url.includes(".supabase.co/storage/v1/object/public/")) return url;
  return `${url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/")}${url.includes("?") ? "&" : "?"}width=${width}&quality=70&resize=contain`;
}
