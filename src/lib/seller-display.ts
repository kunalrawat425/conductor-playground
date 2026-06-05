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
