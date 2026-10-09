/**
 * Signed login sessions.
 *
 * Before this, an API trusted whatever buyer_id / seller_id (+ seller phone)
 * the browser sent. Seller phones are public on seller pages, so anyone could
 * act as any seller, and anyone holding a buyer_id could read that buyer's
 * orders. verify-otp now returns an HMAC-signed token per role; the browser
 * sends it on every /api call (x-rlf-buyer / x-rlf-seller, see AppShell) and
 * the APIs check it matches the id in the request.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type SessionRole = "buyer" | "seller";

const SECRET = import.meta.env.INTERNAL_API_SECRET || process.env.INTERNAL_API_SECRET || "";
const DAYS = 180;

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest();

export function signSession(role: SessionRole, id: string, secret = SECRET, now = Date.now()): string {
  if (!secret) throw new Error("INTERNAL_API_SECRET not configured");
  const payload = b64url(JSON.stringify({ r: role, i: id, e: now + DAYS * 86400_000 }));
  return `${payload}.${b64url(sign(payload, secret))}`;
}

/** The id inside a valid, unexpired token for this role, else null. */
export function verifySession(token: string | null | undefined, role: SessionRole, secret = SECRET, now = Date.now()): string | null {
  if (!token || !secret) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = sign(payload, secret);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString());
    return p.r === role && typeof p.i === "string" && Number(p.e) > now ? p.i : null;
  } catch {
    return null;
  }
}

/** 401 tells the browser to drop the stale login and ask for OTP again. */
function loginRequired(role: SessionRole): Response {
  return new Response(JSON.stringify({ error: "Please log in again", login: role }), {
    status: 401,
    headers: { "x-rlf-login": role, "Content-Type": "application/json" },
  });
}

/** null when the request carries a valid session for exactly this id. */
export function requireSession(request: Request, role: SessionRole, id: string | null | undefined): Response | null {
  // No id at all = a logged-out visitor, not a stale login: plain 400, so the
  // browser does not clear storage and reload.
  if (!id) return new Response(JSON.stringify({ error: `${role}_id required` }), { status: 400 });
  const sessionId = verifySession(request.headers.get(`x-rlf-${role}`), role);
  if (!sessionId) return loginRequired(role);
  if (sessionId !== id) {
    return new Response(JSON.stringify({ error: "Not your account" }), { status: 403 });
  }
  return null;
}

export const requireBuyer = (request: Request, buyerId: string | null | undefined) => requireSession(request, "buyer", buyerId);
export const requireSeller = (request: Request, sellerId: string | null | undefined) => requireSession(request, "seller", sellerId);
