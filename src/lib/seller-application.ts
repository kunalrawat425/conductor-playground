/**
 * New-seller application on /dashboard/pending. Shop basics go on the sellers row through
 * /api/seller/profile; the answers with no column (fish sold, areas served, FSSAI) are
 * emailed to us by /api/seller/apply.
 */

/** verify-otp names a new seller "Seller <last4>": a placeholder, not a name they chose. */
export const isPlaceholderSellerName = (name: string | null | undefined) => /^Seller \d{4}$/.test(String(name ?? "").trim());

/** Their own shop name and an area filled in = they applied. */
export function hasSellerApplied(seller: { name?: string | null; location_name?: string | null } | null | undefined): boolean {
  return !!seller && !isPlaceholderSellerName(seller.name) && String(seller.location_name ?? "").trim() !== "";
}

export type SellerApplication = { fish_sold: string; areas_served: string; fssai: string };

/** Max length per free-text answer; longer text is cut, so a client can't mail us a novel. */
export const APPLICATION_LIMITS = { fish_sold: 300, areas_served: 300 };

/** Trimmed, length-capped answers, or the message to show the seller. Same check in the form and the API. */
export function cleanSellerApplication(body: any): SellerApplication | { error: string } {
  const text = (k: keyof typeof APPLICATION_LIMITS) =>
    (typeof body?.[k] === "string" ? body[k] : "").trim().replace(/\s+/g, " ").slice(0, APPLICATION_LIMITS[k]);
  const app: SellerApplication = {
    fish_sold: text("fish_sold"),
    areas_served: text("areas_served"),
    fssai: typeof body?.fssai === "string" ? body.fssai.replace(/\s+/g, "") : "",
  };
  if (app.fish_sold.length < 2) return { error: "Tell us which fish you sell (e.g. pomfret, surmai, prawns)." };
  if (app.areas_served.length < 2) return { error: "Tell us which areas you serve (e.g. Majiwada, Manpada)." };
  if (!/^\d{14}$/.test(app.fssai)) return { error: "Enter your 14-digit FSSAI licence number." };
  return app;
}

export type DeliveryCharge = "free" | "fixed" | "per_km";
export type DeliveryFeeUpdates = {
  delivery_fee_enabled: boolean;
  delivery_fee_type: "fixed" | "per_km";
  delivery_fee_amount: number;
  delivery_fee_per_km: number;
  free_delivery_above: number;
};

/**
 * The "Delivery charges" answer as the sellers columns the profile page saves:
 * free = fee off; flat = fixed fee per order; per km = rate per km. "Free above" is optional (0 = none).
 */
export function deliveryFeeUpdates(choice: string | null | undefined, amount: unknown, perKm: unknown, freeAbove: unknown): DeliveryFeeUpdates | { error: string } {
  const num = (v: unknown) => (String(v ?? "").trim() === "" ? 0 : Number(v));
  const fee = num(amount), rate = num(perKm), above = num(freeAbove);
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  if (choice === "free") return { delivery_fee_enabled: false, delivery_fee_type: "fixed", delivery_fee_amount: 0, delivery_fee_per_km: 0, free_delivery_above: 0 };
  if (choice !== "fixed" && choice !== "per_km") return { error: "Choose your delivery charges: free, flat fee or per km." };
  if (choice === "fixed" && !positive(fee)) return { error: "Enter your delivery fee per order in ₹." };
  if (choice === "per_km" && !positive(rate)) return { error: "Enter your delivery rate per km in ₹." };
  if (above !== 0 && !positive(above)) return { error: "\"Free delivery above\" must be an amount in ₹, or empty." };
  return {
    delivery_fee_enabled: true,
    delivery_fee_type: choice,
    delivery_fee_amount: choice === "fixed" ? fee : 0,
    delivery_fee_per_km: choice === "per_km" ? rate : 0,
    free_delivery_above: above,
  };
}
