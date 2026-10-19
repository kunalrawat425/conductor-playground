/**
 * Central brand assets. Import instead of hardcoding URLs so a single env var
 * can override across all 20+ usage sites without touching component code.
 *
 * BUG-9 fix: the logo used to live inline in Header/Footer/AppShell/etc.
 * If the storage project changes, one env change swaps it everywhere.
 *
 * Note: `import.meta.env.X` must be referenced directly — esbuild treats
 * `import.meta` as a syntactic form, so `typeof import.meta` is a parse error.
 */

// Resized by Supabase's image transform: the original PNG is 2752 px / 1.3 MB, shown at most ~150 px wide.
const DEFAULT_LOGO =
  "https://witoghpdfocywiosmrzv.supabase.co/storage/v1/render/image/public/meta/logo_horizontal.png?width=480&quality=80&resize=contain";

// Astro inlines PUBLIC_* into client bundles; server reads them at runtime.
export const LOGO_URL: string = import.meta.env.PUBLIC_LOGO_URL || DEFAULT_LOGO;

export const BRAND_NAME: string = import.meta.env.PUBLIC_BRAND_NAME || "Relifish";

/** Canonical origin. relifish.com, relifish.store and www.relifish.store 308-redirect here (Vercel domains + vercel.json). */
export const SITE_URL = "https://www.relifish.com";

/** One URL per page for Google: www host, no query string, no trailing slash (root stays "/"). */
export function canonicalFor(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
  return new URL(path, SITE_URL).href;
}

/** Who runs Relifish, shown in the footer and on /contact, /about and /terms (Merchant Center business identity). */
export const BUSINESS_OPERATOR = "Kunal Rawat (founder)";
// TODO founder: full public address before merge
export const BUSINESS_ADDRESS = "";
/** "Relifish is operated by Kunal Rawat (founder)", plus ", <address>" once BUSINESS_ADDRESS is set. */
export const OPERATED_BY = `Relifish is operated by ${BUSINESS_OPERATOR}${BUSINESS_ADDRESS ? `, ${BUSINESS_ADDRESS}` : ""}`;
