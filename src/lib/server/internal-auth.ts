/**
 * BUG-14/16 helper: server-to-server endpoints must not be publicly callable.
 * Each internal endpoint checks a shared secret header. All server-side
 * `fetch(url.origin + ...)` callers must add the header.
 */
const INTERNAL_API_SECRET = import.meta.env.INTERNAL_API_SECRET || "";

export const INTERNAL_HEADER = "x-internal-api-secret";

/**
 * Returns Response(401) if secret is missing/wrong, or null if OK.
 */
export function assertInternalCaller(request: Request): Response | null {
  if (!INTERNAL_API_SECRET) {
    // Fail-open in dev if not configured, but log so ops sees it.
    // In prod set INTERNAL_API_SECRET or these endpoints stay open.
    console.warn("[internal-auth] INTERNAL_API_SECRET not configured — endpoint publicly callable");
    return null;
  }
  const got = request.headers.get(INTERNAL_HEADER) || "";
  if (got !== INTERNAL_API_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized (internal caller only)" }), { status: 401 });
  }
  return null;
}

export function internalHeaders(): Record<string, string> {
  return INTERNAL_API_SECRET ? { [INTERNAL_HEADER]: INTERNAL_API_SECRET } : {};
}
