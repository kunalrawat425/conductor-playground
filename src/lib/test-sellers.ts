/**
 * Test sellers (`sellers.is_test`, migration 071) stay inactive and hidden from lists, but are
 * reachable/orderable by direct link for QA — on staging and previews only. On the live site
 * (VERCEL_ENV=production) they behave like any inactive seller: no page, no orders.
 */
export function testSellersAllowed(vercelEnv: string | undefined): boolean {
  return vercelEnv !== "production";
}

/** True when an inactive seller must be treated as unavailable. */
export function sellerBlocked(seller: { is_active?: boolean | null; is_test?: boolean | null } | null | undefined, vercelEnv: string | undefined): boolean {
  if (!seller || seller.is_active !== false) return false;
  return !(seller.is_test && testSellersAllowed(vercelEnv));
}
