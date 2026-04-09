import type { PriceUnit } from "./species";

export interface ListingPriceOption {
  id: string;
  /** Seller-defined label, e.g. "Large piece", "Per dozen" */
  label: string;
  /** Amount charged at checkout (single source of truth for orders). */
  price: number;
  unit: PriceUnit;
  /**
   * Optional higher "was / list" price for display (strikethrough + % off).
   * When set, must be greater than `price`.
   */
  compare_at_price?: number;
}

/** Minimal listing fields for pricing helpers (avoids circular import with supabase.ts). */
export type ListingPricingSource = {
  pricing_options?: ListingPriceOption[] | unknown[] | null;
};

/** Legacy schema allowed `kg`; inventory + menus use piece/dozen only. */
function normalizeUnitRaw(raw: string): PriceUnit {
  const u = String(raw || "piece").toLowerCase();
  if (u === "dozen") return "dozen";
  if (u === "kg") return "piece";
  return u === "piece" ? "piece" : "piece";
}

function normalizeLabelForUnit(label: string, originalUnit: string): string {
  let s = String(label ?? "").trim() || "Option";
  if (
    originalUnit === "kg" ||
    /^per\s*kg$/i.test(s) ||
    /^kg$/i.test(s) ||
    /^per\s*kg\b/i.test(s)
  ) {
    s = "Per piece";
  } else if (/\bper\s*kg\b/i.test(s) || /^per\s*kg\s*\)/i.test(s)) {
    s = s.replace(/\bper\s*kg\b/gi, "Per piece").replace(/\s+/g, " ").trim() || "Per piece";
  } else if (/\bkg\b/i.test(s)) {
    s = s.replace(/\bper\s*kg\b/gi, "Per piece").replace(/\bkg\b/gi, "piece").replace(/\s+/g, " ").trim();
    if (!s) s = "Per piece";
  }
  return s;
}

/** PostgREST / drivers occasionally return jsonb as a JSON string — normalize for UI + orders. */
function normalizePricingOptionsRaw(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  return raw;
}

function parseCompareAt(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}

/**
 * Canonical multi-tier payload from client or DB jsonb. Returns null if nothing valid.
 */
export function canonicalPricingOptionsFromPayload(raw: unknown): ListingPriceOption[] | null {
  const normalized = normalizePricingOptionsRaw(raw);
  if (normalized == null || !Array.isArray(normalized) || normalized.length === 0) return null;
  const out: ListingPriceOption[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const o = normalized[i] as Record<string, unknown>;
    const id = String(o.id ?? `opt_${i}`);
    const price = Number(o.price);
    const unitRawIn = String(o.unit ?? "piece");
    const unit = normalizeUnitRaw(unitRawIn);
    const label = normalizeLabelForUnit(String(o.label ?? "").trim() || "Option", unitRawIn);
    if (!Number.isFinite(price) || price <= 0) continue;
    const cap = parseCompareAt(o.compare_at_price);
    const row: ListingPriceOption = { id, label, price, unit };
    if (cap != null && cap > price) row.compare_at_price = cap;
    out.push(row);
  }
  return out.length > 0 ? out : null;
}

export type PricingJsonValidation =
  | { ok: true; options: ListingPriceOption[] }
  | { ok: false; message: string };

/** Create/edit listing: hidden field must parse and yield at least one tier with ₹ &gt; 0. */
export function validateListingPricingJson(json: string): PricingJsonValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json || "[]");
  } catch {
    return { ok: false, message: "Pricing data is invalid. Refresh and try again." };
  }
  if (Array.isArray(parsed)) {
    for (const row of parsed) {
      const o = row as Record<string, unknown>;
      const p = Number(o.price);
      const cap = o.compare_at_price != null && o.compare_at_price !== "" ? Number(o.compare_at_price) : NaN;
      if (Number.isFinite(cap) && Number.isFinite(p) && cap <= p) {
        return {
          ok: false,
          message: "Compare-at / list price must be higher than the selling price when set.",
        };
      }
    }
  }
  const opts = canonicalPricingOptionsFromPayload(parsed);
  if (!opts || opts.length === 0) {
    return {
      ok: false,
      message: "Add at least one price with a positive ₹ amount (minimum ₹1 per tier).",
    };
  }
  for (const o of opts) {
    if (o.price < 1) {
      return { ok: false, message: "Each price must be at least ₹1." };
    }
    if (o.compare_at_price != null) {
      if (o.compare_at_price <= o.price) {
        return {
          ok: false,
          message: "Compare-at / list price must be higher than the selling price when you set a deal.",
        };
      }
      if (o.compare_at_price < 1) {
        return { ok: false, message: "Compare-at price must be at least ₹1." };
      }
    }
  }
  return { ok: true, options: opts };
}

/** Display / checkout — reads `pricing_options` only. */
export function getListingPriceOptions(listing: ListingPricingSource): ListingPriceOption[] {
  return canonicalPricingOptionsFromPayload(listing.pricing_options as unknown) ?? [];
}

export function getListingOptionById(
  listing: ListingPricingSource,
  optionId: string | null | undefined
): ListingPriceOption | undefined {
  const opts = getListingPriceOptions(listing);
  if (opts.length === 0) return undefined;
  if (!optionId) return opts[0];
  return opts.find((o) => o.id === optionId) ?? opts[0];
}

/** True when menu should show strikethrough list price + badge. */
export function optionHasDealDisplay(o: ListingPriceOption): boolean {
  const c = o.compare_at_price;
  return c != null && Number.isFinite(c) && c > o.price;
}

/** Rounded percent saved vs compare-at (for badges). */
export function optionDiscountPercentDisplay(o: ListingPriceOption): number | null {
  if (!optionHasDealDisplay(o) || o.compare_at_price == null || o.compare_at_price <= 0) return null;
  return Math.max(0, Math.round((1 - o.price / o.compare_at_price) * 100));
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
    const o = opts[0];
    const u = o.unit === "dozen" ? "dz" : "pc";
    if (optionHasDealDisplay(o) && o.compare_at_price != null) {
      return `₹${o.price}/${u} (was ₹${o.compare_at_price})`;
    }
    return `₹${o.price}/${u}`;
  }
  const minP = Math.min(...opts.map((o) => o.price));
  return `From ₹${minP}`;
}
