import { createHmac } from "node:crypto";

const SECRET = process.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_SERVICE_KEY || "dev-fallback-secret";

/** Rolling 1-hour window so stolen tokens expire quickly. */
function hourWindow(): number {
  return Math.floor(Date.now() / 3_600_000);
}

function sign(id: string, role: "seller" | "buyer", hour: number): string {
  return createHmac("sha256", SECRET)
    .update(`${role}:${id}:${hour}`)
    .digest("hex");
}

/** Generate a token valid for ~1-2 hours (current + previous window accepted on verify). */
export function generateToken(id: string, role: "seller" | "buyer"): string {
  const hour = hourWindow();
  const mac = sign(id, role, hour);
  return `${id}:${mac}`;
}

/**
 * Verify token from X-Seller-Token or X-Buyer-Token header.
 * Accepts current and previous hour window to handle boundary edge cases.
 * Returns the id if valid, null otherwise.
 */
export function verifyToken(
  token: string | null | undefined,
  expectedId: string,
  role: "seller" | "buyer"
): boolean {
  if (!token) return false;
  const colon = token.indexOf(":");
  if (colon === -1) return false;
  const id = token.slice(0, colon);
  const mac = token.slice(colon + 1);
  if (id !== expectedId) return false;
  const hour = hourWindow();
  // Accept current and previous window
  return sign(id, role, hour) === mac || sign(id, role, hour - 1) === mac;
}

/** Extract seller_id from request + verify token. Returns seller_id or null. */
export async function authenticateSeller(request: Request): Promise<string | null> {
  let seller_id: string | null = null;

  // Try body (POST) and query param (GET) for seller_id
  const url = new URL(request.url);
  seller_id = url.searchParams.get("seller_id");

  if (!seller_id && request.method !== "GET") {
    try {
      const clone = request.clone();
      const ct = request.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const body = await clone.json();
        seller_id = body?.seller_id ?? null;
      } else if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
        const fd = await clone.formData();
        seller_id = fd.get("seller_id")?.toString() ?? null;
      }
    } catch {}
  }

  if (!seller_id) return null;
  const token = request.headers.get("x-seller-token");
  return verifyToken(token, seller_id, "seller") ? seller_id : null;
}

/** Extract buyer_id from request + verify token. Returns buyer_id or null. */
export async function authenticateBuyer(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  let buyer_id = url.searchParams.get("buyer_id");

  if (!buyer_id && request.method !== "GET") {
    try {
      const clone = request.clone();
      const ct = request.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const body = await clone.json();
        buyer_id = body?.buyer_id ?? null;
      }
    } catch {}
  }

  if (!buyer_id) return null;
  const token = request.headers.get("x-buyer-token");
  return verifyToken(token, buyer_id, "buyer") ? buyer_id : null;
}
