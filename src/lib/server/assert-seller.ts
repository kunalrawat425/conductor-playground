import { requireSeller } from "./session";

/**
 * Seller ownership gate for every seller endpoint. seller_id and seller phone
 * are both public (search results, seller pages), so neither proves anything;
 * the request must carry the seller's signed session (src/lib/server/session.ts).
 * seller_phone is still accepted from older clients and ignored.
 *
 *   const check = await assertSellerOwns(seller_id, seller_phone, request);
 *   if (check instanceof Response) return check;
 */
export async function assertSellerOwns(
  seller_id: string | undefined | null,
  _seller_phone: string | undefined | null,
  request: Request
): Promise<Response | { ok: true }> {
  if (!seller_id) {
    return new Response(JSON.stringify({ error: "seller_id required" }), { status: 400 });
  }
  return requireSeller(request, seller_id) ?? { ok: true };
}

export const AWAITING_APPROVAL = "Your shop is awaiting approval. Listings open after approval.";

/**
 * After assertSellerOwns, for listing writes: a seller we haven't approved yet (is_active false)
 * gets 403. The dashboard hides listings from them too; this stops direct API calls.
 * Not for /api/seller/profile or /api/seller/apply: the application form needs those.
 */
export async function assertSellerApproved(
  supabase: { from: (t: string) => any },
  seller_id: string
): Promise<Response | null> {
  const { data, error } = await supabase.from("sellers").select("is_active").eq("id", seller_id).maybeSingle();
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!data || data.is_active === false) {
    return new Response(JSON.stringify({ error: AWAITING_APPROVAL }), { status: 403 });
  }
  return null;
}
