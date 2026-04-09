import type { PriceUnit } from "./species";

export interface ListingPriceOption {
  id: string;
  /** Seller-defined label, e.g. "Large piece", "Per dozen", "Retail / kg" */
  label: string;
  price: number;
  unit: PriceUnit;
}

/** Minimal listing fields for pricing helpers (avoids circular import with supabase.ts). */
export type ListingPricingSource = {
  price: number;
  price_unit: PriceUnit;
  pricing_options?: ListingPriceOption[] | unknown[] | null;
};

function isPriceUnit(u: string): u is PriceUnit {
  return u === "piece" || u === "dozen";
}

/** PostgREST / drivers occasionally return jsonb as a JSON string — normalize for UI + orders. */
function normalizePricingOptionsRaw(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed;
    } catch {
      return null;
    }
  }
  return raw;
}

/** Normalize DB json or legacy single price into a non-empty option list */
export function getListingPriceOptions(listing: ListingPricingSource): ListingPriceOption[] {
  const raw = normalizePricingOptionsRaw(listing.pricing_options as unknown);
  if (raw != null && Array.isArray(raw) && raw.length > 0) {
    const out: ListingPriceOption[] = [];
    for (let i = 0; i < raw.length; i++) {
      const o = raw[i] as Record<string, unknown>;
      const id = String(o.id ?? `opt_${i}`);
      const label = String(o.label ?? "").trim() || "Option";
      const price = Number(o.price);
      const unitRaw = String(o.unit ?? "piece");
      const unit = isPriceUnit(unitRaw) ? unitRaw : "piece";
      if (!Number.isFinite(price) || price <= 0) continue;
      out.push({ id, label, price, unit });
    }
    if (out.length > 0) return out;
  }
  const pu = listing.price_unit;
  const unit: PriceUnit = pu === "dozen" || pu === "piece" ? pu : "piece";
  return [
    {
      id: "default",
      label: unit === "dozen" ? "Per dozen" : "Per piece",
      price: Number(listing.price) || 0,
      unit,
    },
  ];
}

export function getListingOptionById(
  listing: ListingPricingSource,
  optionId: string | null | undefined
): ListingPriceOption | undefined {
  const opts = getListingPriceOptions(listing);
  if (!optionId) return opts[0];
  return opts.find((o) => o.id === optionId) ?? opts[0];
}

/** Short label for menus: ₹200 / pc */
export function formatOptionMenuLabel(opt: ListingPriceOption): string {
  const u = opt.unit === "dozen" ? "dz" : "pc";
  return `₹${opt.price} · ${opt.label} (${u})`;
}

/** Dashboard / home preview */
export function formatListingPriceSummary(listing: ListingPricingSource): string {
  const opts = getListingPriceOptions(listing);
  if (opts.length === 0) return "—";
  if (opts.length === 1) {
    const u = opts[0].unit === "dozen" ? "dz" : "pc";
    return `₹${opts[0].price}/${u}`;
  }
  const minP = Math.min(...opts.map((o) => o.price));
  return `From ₹${minP}`;
}
