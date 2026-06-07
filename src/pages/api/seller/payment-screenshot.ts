import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

import { verifyToken } from "../../../lib/server/auth-token";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.trim());
  } catch {
    return s.trim();
  }
}

/** Variants of the requested path for matching DB rows (encoding, signed URLs, etc.). */
function pathMatchCandidates(requested: string): string[] {
  const raw = (requested || "").trim();
  const set = new Set<string>();
  if (raw) set.add(raw);
  const once = safeDecode(raw);
  if (once) set.add(once);
  try {
    const twice = decodeURIComponent(once);
    if (twice && twice !== once) set.add(twice);
  } catch {
    /* ignore */
  }
  // Supabase object URL → storage object path inside bucket `order-payments`
  for (const s of [...set]) {
    const m = s.match(/\/(?:object|storage\/v1\/object)\/(?:sign|public)\/order-payments\/([^?#]+)/);
    if (m?.[1]) {
      const inner = decodeURIComponent(m[1]);
      set.add(inner);
      set.add(`order-payments/${inner}`);
    }
    const m2 = s.match(/(order-payments\/[^?#]+\.[a-zA-Z0-9]+)/);
    if (m2?.[1]) set.add(m2[1]);
  }
  return [...set].filter(Boolean);
}

/** Pick the exact string stored in `payment_screenshot_urls` for signing. */
function pickStoredPath(urls: string[] | null | undefined, requested: string): string | null {
  const arr = (urls || []).filter(Boolean);
  if (!arr.length || !requested) return null;
  const candidates = pathMatchCandidates(requested);
  for (const u of arr) {
    const uTrim = u.trim();
    if (candidates.includes(uTrim)) return u;
  }
  for (const u of arr) {
    const ud = safeDecode(u);
    for (const c of candidates) {
      if (ud === c || u === c) return u;
    }
  }
  const wantLast = (candidates[0] || "").split("/").filter(Boolean).pop() || "";
  if (wantLast) {
    for (const u of arr) {
      const last = u.split("/").filter(Boolean).pop() || "";
      if (last === wantLast) return u;
    }
  }
  return null;
}

async function findOrderByPathRow(
  supabase: ReturnType<typeof createClient>,
  pathCandidates: string[],
): Promise<{ id: string; listing_id: string | null; seller_id: string | null; payment_screenshot_urls: string[] } | null> {
  for (const p of pathCandidates) {
    const { data, error } = await supabase
      .from("orders")
      .select("id, listing_id, seller_id, payment_screenshot_urls")
      .contains("payment_screenshot_urls", [p])
      .limit(1);
    if (!error && data && data[0]) return data[0] as any;
  }
  return null;
}

/**
 * GET /api/seller/payment-screenshot?order_id=&seller_id=&path=
 * Verifies seller owns the order, generates a fresh signed URL (1h expiry).
 * Path is a Supabase Storage path stored in orders.payment_screenshot_urls[].
 */
export const GET: APIRoute = async ({ url, request }) => {
  try {
    const order_id = url.searchParams.get("order_id");
    const seller_id = url.searchParams.get("seller_id");
    const pathParam = url.searchParams.get("path");

    if (!order_id || !seller_id || !pathParam) {
      return new Response(JSON.stringify({ error: "order_id, seller_id, and path required" }), { status: 400 });
    }
    if (!verifyToken(request.headers.get("x-seller-token"), seller_id, "seller")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const pathCandidates = pathMatchCandidates(pathParam);

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("listing_id, payment_screenshot_urls")
      .eq("id", order_id)
      .maybeSingle();

    let resolvedOrder: any = order;
    if (orderErr) {
      console.error("payment-screenshot: order by id error", order_id, orderErr.message);
    }
    if (!resolvedOrder) {
      resolvedOrder = await findOrderByPathRow(supabase, pathCandidates);
    }
    if (!resolvedOrder) {
      return new Response(JSON.stringify({ error: "Order not found for this payment screenshot" }), { status: 404 });
    }

    let authorized = false;
    if (resolvedOrder.listing_id) {
      const { data: listing } = await supabase
        .from("fish_listings")
        .select("seller_id")
        .eq("id", resolvedOrder.listing_id)
        .maybeSingle();
      authorized = listing?.seller_id === seller_id;
    }

    if (!authorized) {
      return new Response(JSON.stringify({ error: "Not your order" }), { status: 403 });
    }

    const urls: string[] = resolvedOrder.payment_screenshot_urls || [];
    const matched = pickStoredPath(urls, pathParam);
    if (!matched) {
      return new Response(JSON.stringify({ error: "Screenshot not found on this order" }), { status: 404 });
    }

    const { data: signed, error: signErr } = await supabase.storage.from("order-payments").createSignedUrl(matched, 3600);

    if (signErr || !signed?.signedUrl) {
      return new Response(JSON.stringify({ error: signErr?.message || "Could not generate URL" }), { status: 500 });
    }

    return new Response(JSON.stringify({ url: signed.signedUrl }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
