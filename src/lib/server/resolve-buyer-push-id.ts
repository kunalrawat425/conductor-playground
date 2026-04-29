import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Candidate `buyers.phone` values to try (table stores digits, often last 10 for India).
 */
export function buyerPhoneLookupCandidates(raw: string | null | undefined): string[] {
  if (raw == null || typeof raw !== "string") return [];
  const d = raw.replace(/\D/g, "");
  if (!d) return [];
  const out = new Set<string>();
  if (d.length >= 10) out.add(d.slice(-10));
  out.add(d);
  return [...out];
}

/**
 * Resolve buyer row id for Web Push: prefer explicit buyer_id, else lookup by order phone.
 */
export async function resolveBuyerIdForPush(
  supabase: SupabaseClient,
  buyer_id: string | null | undefined,
  buyer_phone: string | null | undefined
): Promise<string | null> {
  const id = buyer_id && String(buyer_id).trim();
  if (id) return id;

  const candidates = buyerPhoneLookupCandidates(buyer_phone ?? undefined);
  if (candidates.length === 0) return null;

  const { data: rows, error } = await supabase.from("buyers").select("id").in("phone", candidates).limit(1);

  if (error || !rows?.length) return null;
  return (rows[0] as { id: string }).id;
}
