/** Strip whitespace / accidental quotes (for VAPID subject / env hygiene). */
export function trimVapidKey(s: string | undefined): string {
  if (!s) return "";
  return s.trim().replace(/^["']+|["']+$/g, "");
}

/**
 * web-push validates keys with /^[A-Za-z0-9\-_]+$/ (base64url, no "=").
 * Keys pasted from some tools use standard base64 (+, /) and padding (=).
 */
export function normalizeVapidKeyForWebPush(s: string | undefined): string {
  let k = trimVapidKey(s);
  if (!k) return "";
  k = k.replace(/\+/g, "-").replace(/\//g, "_");
  k = k.replace(/=+$/g, "");
  return k;
}
