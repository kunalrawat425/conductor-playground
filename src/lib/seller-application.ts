/**
 * New-seller application on /dashboard/pending. Shop basics go on the sellers row through
 * /api/seller/profile; the answers with no column (fish sold, where they buy, FSSAI) are
 * emailed to us by /api/seller/apply.
 */

/** verify-otp names a new seller "Seller <last4>": a placeholder, not a name they chose. */
export const isPlaceholderSellerName = (name: string | null | undefined) => /^Seller \d{4}$/.test(String(name ?? "").trim());

/** Their own shop name and an area filled in = they applied. */
export function hasSellerApplied(seller: { name?: string | null; location_name?: string | null } | null | undefined): boolean {
  return !!seller && !isPlaceholderSellerName(seller.name) && String(seller.location_name ?? "").trim() !== "";
}

export type SellerApplication = { fish_sold: string; source_market: string; fssai: string };

/** Max length per answer; longer text is cut, so a client can't mail us a novel. */
export const APPLICATION_LIMITS: Record<keyof SellerApplication, number> = { fish_sold: 300, source_market: 120, fssai: 14 };

/** Trimmed, length-capped answers, or the message to show the seller. Same check in the form and the API. */
export function cleanSellerApplication(body: any): SellerApplication | { error: string } {
  const text = (k: keyof SellerApplication) =>
    (typeof body?.[k] === "string" ? body[k] : "").trim().replace(/\s+/g, " ").slice(0, APPLICATION_LIMITS[k]);
  const app: SellerApplication = {
    fish_sold: text("fish_sold"),
    source_market: text("source_market"),
    fssai: typeof body?.fssai === "string" ? body.fssai.replace(/\s+/g, "").slice(0, APPLICATION_LIMITS.fssai) : "",
  };
  if (app.fish_sold.length < 2) return { error: "Tell us which fish you sell (e.g. pomfret, surmai, prawns)." };
  if (app.fssai && !/^\d{14}$/.test(app.fssai)) return { error: "FSSAI licence number is 14 digits. Leave it empty if you don't have one." };
  return app;
}
