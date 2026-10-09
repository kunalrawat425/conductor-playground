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
