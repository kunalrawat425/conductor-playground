import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * BUG-12 helper: seller_id is exposed publicly in /api/search responses, so
 * it cannot be trusted as a bearer credential alone. Every seller-mutation
 * endpoint must verify seller_phone matches the row's phone before acting.
 *
 * Returns { ok: true } if verified, or Response(403) to return to caller.
 * Usage:
 *   const check = await assertSellerOwns(seller_id, seller_phone);
 *   if (check instanceof Response) return check;
 */
export async function assertSellerOwns(seller_id: string | undefined | null, seller_phone: string | undefined | null): Promise<Response | { ok: true }> {
  if (!seller_id) {
    return new Response(JSON.stringify({ error: "seller_id required" }), { status: 400 });
  }
  if (!seller_phone) {
    return new Response(JSON.stringify({ error: "seller_phone required (BUG-12 auth gate)" }), { status: 403 });
  }
  const sb = createClient(supabaseUrl, supabaseServiceKey);
  const { data: row } = await sb.from("sellers").select("phone").eq("id", seller_id).single();
  if (!row) {
    return new Response(JSON.stringify({ error: "Seller not found" }), { status: 404 });
  }
  const norm = (s: string) => (s || "").replace(/^\+?91/, "").replace(/^\+/, "").replace(/\D/g, "");
  if (norm(String(seller_phone)) !== norm(String(row.phone))) {
    return new Response(JSON.stringify({ error: "Unauthorized — seller phone mismatch" }), { status: 403 });
  }
  return { ok: true };
}
