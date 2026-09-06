/**
 * Shared in-memory sliding-window rate limiter for public endpoints.
 *
 * Note on serverless: each Vercel instance keeps its own bucket, so the real
 * ceiling is `max * instanceCount` per window. That still cuts an unbounded
 * flood down to a bounded trickle. Move to Vercel KV / Redis if an attack
 * actually materialises.
 */

type Bucket = number[];
const buckets = new Map<string, Bucket>();

/** Resolve a client key from proxy headers (Vercel sets x-forwarded-for). */
export function clientKey(request: Request): string {
  const xff = request.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "anon";
}

/**
 * Returns true when the caller has exceeded `max` requests in `windowMs`.
 * Records the current attempt either way.
 */
export function overLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  buckets.set(key, arr);

  // Opportunistic cleanup so the Map cannot grow unbounded across warm invocations.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }

  return arr.length > max;
}

/**
 * Convenience wrapper: returns a 429 Response when over limit, else null.
 */
export function rateLimit(request: Request, max: number, windowMs: number): Response | null {
  if (overLimit(clientKey(request), max, windowMs)) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please try again shortly." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(windowMs / 1000)),
        },
      }
    );
  }
  return null;
}
