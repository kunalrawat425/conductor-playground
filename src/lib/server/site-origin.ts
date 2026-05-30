/**
 * Canonical public origin for absolute links in emails and Web Push payloads.
 */
export function siteOriginFromEnv(): string {
  const env = import.meta.env.VERCEL_ENV || process.env.VERCEL_ENV || "";
  if (env === "production") {
    return "https://relifish.store";
  }
  if (env === "preview") {
    return "https://stage.relifish.store";
  }

  // Fallback for local development or custom configurations
  const raw = import.meta.env.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL;
  if (typeof raw === "string" && raw.trim()) {
    return raw.replace(/\/$/, "");
  }

  const v = import.meta.env.VERCEL_URL || process.env.VERCEL_URL;
  if (typeof v === "string" && v.trim()) {
    // If it's a Vercel deployment but not marked as production, treat as staging
    return "https://stage.relifish.store";
  }

  return "https://relifish.store";
}

export function absoluteUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${siteOriginFromEnv()}${p}`;
}
