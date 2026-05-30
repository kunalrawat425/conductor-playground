/**
 * Canonical public origin for absolute links in emails and Web Push payloads.
 */
export function siteOriginFromEnv(): string {
  const env = import.meta.env.VERCEL_ENV || process.env.VERCEL_ENV || "";
  if (env === "production") {
    return "https://relifish.store";
  }

  const raw = import.meta.env.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL;
  if (typeof raw === "string" && raw.trim()) {
    return raw.replace(/\/$/, "");
  }

  const v = import.meta.env.VERCEL_URL || process.env.VERCEL_URL;
  if (typeof v === "string" && v.trim()) {
    const host = v.replace(/^https?:\/\//, "");
    return `https://${host}`;
  }

  return "https://relifish.store";
}

export function absoluteUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${siteOriginFromEnv()}${p}`;
}
