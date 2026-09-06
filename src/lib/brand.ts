/**
 * Central brand assets. Import instead of hardcoding URLs so a single env var
 * can override across all 20+ usage sites without touching component code.
 *
 * BUG-9 fix: the logo used to live inline in Header/Footer/AppShell/etc.
 * If the storage project changes, one env change swaps it everywhere.
 */

const DEFAULT_LOGO = "https://witoghpdfocywiosmrzv.supabase.co/storage/v1/object/public/meta/logo_horizontal.png";

// Astro exposes PUBLIC_* to client bundles; server also reads it.
export const LOGO_URL: string =
  (typeof import.meta !== "undefined" && (import.meta as any)?.env?.PUBLIC_LOGO_URL) ||
  DEFAULT_LOGO;

export const BRAND_NAME: string =
  (typeof import.meta !== "undefined" && (import.meta as any)?.env?.PUBLIC_BRAND_NAME) ||
  "Relifish";
