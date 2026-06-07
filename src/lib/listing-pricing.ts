import type { PriceUnit } from "./species";

export interface ListingPriceOption {
  id: string;
  /** Seller-defined label, e.g. "Large piece", "Per kg" */
  label: string;
  /** Amount charged at checkout (single source of truth for same-day orders). */
  price: number;
  unit: PriceUnit;
  /**
   * Amount of inventory this ₹ line covers, in the tier’s unit:
   * **piece**: whole units (≥ 1). **1** = per piece; **2+** = fixed pack size.
   * **kg**: kilograms per price (≥ 0.01). **1** = ₹ per kg; **0.5** = half-kg pack, etc.
   */
  bundle_size?: number;
  /**
   * Optional higher "was / list" price for display (strikethrough + % off).
   * When set, must be greater than `price`. Not shown in pre-order mode.
   */
  compare_at_price?: number;
  /** Pre-order estimated minimum price for this tier. Buyer sees range; no discount applies. */
  preorder_price_min?: number | null;
  /** Pre-order estimated maximum price for this tier. Buyer pays this at order time. */
  preorder_price_max?: number | null;
}

/** Minimal listing fields for pricing helpers (avoids circular import with supabase.ts). */
export type ListingPricingSource = {
  pricing_options?: ListingPriceOption[] | unknown[] | null;
};

function normalizeUnitRaw(raw: string): PriceUnit {
  const u = String(raw || "piece").toLowerCase();
  if (u === "dozen") return "piece";
  if (u === "kg") return "kg";
  /** Legacy JSON may still say gram — canonical output is always kg for weight. */
  if (u === "gram" || u === "g") return "kg";
  return "piece";
}

function normalizeLabelForUnit(
  label: string,
  _originalUnit: string,
  unit: PriceUnit
): string {
  if (unit === "kg") {
    const s = String(label ?? "").trim();
    return s || "Per kg";
  }
  let s = String(label ?? "").trim() || "Option";
  if (
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

/** Slash after menu/preorder prices: `/pc`, `/3pc`, `/kg`, `/0.5kg`. Matches multi-tier bundle hints. */
export function formatBuyerMenuUnitSuffix(opt: ListingPriceOption | undefined): string {
  if (!opt) return "/pc";
  if (opt.unit === "kg") {
    if (isPerBaseUnitPricing(opt)) return "/kg";
    const amt = optionBundleAmount(opt);
    const r = Math.round(amt * 100) / 100;
    if (r > 0 && r < 1) {
      return `/${Math.round(r * 1000)} grams`;
    }
    return `/${r} kg`;
  }
  if (isPerBaseUnitPricing(opt)) return "/pc";
  const n = Math.floor(optionBundleAmount(opt));
  return `/${n}pc`;
}

/** Short suffix for menus and cart (pc, dz, kg, g). */
export function priceUnitShortLabel(unit: PriceUnit): string {
  switch (unit) {
    case "kg":
      return "kg";
    default:
      return "pc";
  }
}

/** `<input type="number">` step for the single inventory field (`weight_avail`) by pricing unit. */
export function stockQuantityInputStep(unit: PriceUnit): string {
  return unit === "kg" ? "0.01" : "1";
}

/**
 * Format stored inventory for display (menus, dashboards). Aligns with how sellers enter stock
 * (whole units for pc/g; decimals for kg).
 */
export function formatInventoryAmount(n: number, unit: PriceUnit): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return "0";
  if (unit === "kg") return String(Number(v.toFixed(2)));
  return String(Math.floor(v));
}

/** Max order quantity from available stock (integer counts; kg keeps up to 2 decimal places). */
export function maxOrderQtyFromStock(weightAvail: number, unit: PriceUnit): number {
  const w = Number(weightAvail);
  if (!Number.isFinite(w) || w <= 0) return 0;
  if (unit === "kg") return Math.round(w * 100) / 100;
  return Math.floor(w);
}

/**
 * How many **packs** fit in stock when each pack uses `bundleAmount` base units.
 * Call only when `!isPerBaseUnitPricing` for that option (multi-pack / fixed-weight lines).
 */
export function maxBundlesFromStock(weightAvail: number, unit: PriceUnit, bundleAmount: number): number {
  const a = Number(bundleAmount);
  if (!Number.isFinite(a) || a <= 0) return 0;
  const maxBase = maxOrderQtyFromStock(weightAvail, unit);
  if (unit === "kg") {
    return Math.floor(maxBase / a + 1e-9);
  }
  const bi = Math.floor(a);
  if (!Number.isFinite(bi) || bi < 2) return maxOrderQtyFromStock(weightAvail, unit);
  return Math.floor(maxBase / bi);
}

/**
 * Inventory amount covered by one price line (divisor for order quantity → line total).
 * Piece: integer ≥ 1. Kg: rounded to 2 decimals, ≥ 0.01 (default 1).
 */
export function optionBundleAmount(o: ListingPriceOption | undefined): number {
  if (!o) return 1;
  const raw = o.bundle_size != null ? Number(o.bundle_size) : NaN;
  if (o.unit === "kg") {
    if (!Number.isFinite(raw) || raw < 0.01) return 1;
    return Math.round(raw * 100) / 100;
  }
  if (o.unit === "piece") {
    if (!Number.isFinite(raw) || raw < 1) return 1;
    return Math.max(1, Math.floor(raw));
  }
  return 1;
}

/**
 * True when `price` is billed per single base unit (1 pc or 1.00 kg) — loose qty, not fixed packs.
 */
export function isPerBaseUnitPricing(o: ListingPriceOption | undefined): boolean {
  if (!o) return true;
  const a = optionBundleAmount(o);
  if (o.unit === "kg") {
    return Math.abs(a - 1) < 0.0001;
  }
  return a === 1;
}

/** @deprecated Prefer optionBundleAmount + isPerBaseUnitPricing */
export function optionBundleSize(o: ListingPriceOption | undefined): number {
  return optionBundleAmount(o);
}

/**
 * Smallest base-unit quantity for a single line item: minimum pack size among pack tiers,
 * or 1 base unit when every tier is per-piece or per-kg.
 */
export function minimumSingleOrderBaseUnits(options: ListingPriceOption[]): number {
  if (options.length === 0) return 1;
  const packSizes = options.filter((o) => !isPerBaseUnitPricing(o)).map((o) => optionBundleAmount(o));
  if (packSizes.length === 0) return 1;
  return Math.min(...packSizes);
}

/**
 * Base units needed on the **cheapest** price tier to reach the seller minimum order ₹ (when set).
 * Uses the lowest ₹ price so this is the worst case (most units) for hitting the minimum.
 */
export function minBaseUnitsForSellerMinOrder(options: ListingPriceOption[], sellerMinOrderAmt: number): number {
  const m = Number(sellerMinOrderAmt);
  if (!options.length || !Number.isFinite(m) || m <= 0) return 1;
  let cheapest: ListingPriceOption | undefined;
  let minP = Infinity;
  for (const o of options) {
    if (o.price > 0 && o.price < minP) {
      minP = o.price;
      cheapest = o;
    }
  }
  if (!cheapest) return 1;
  const ba = optionBundleAmount(cheapest);
  const perBase = isPerBaseUnitPricing(cheapest);
  const packsNeeded = Math.ceil(m / cheapest.price);
  return Math.max(1, packsNeeded * (perBase ? 1 : ba));
}

/**
 * Minimum `buyer_daily_qty_limit` (in listing inventory units) so a buyer can place at least
 * one valid order: enough for the smallest pack, and enough to satisfy seller min ₹ on the cheapest tier.
 */
export function minimumRequiredBuyerDailyCap(options: ListingPriceOption[], sellerMinOrderAmt: number): number {
  return Math.max(
    minBaseUnitsForSellerMinOrder(options, sellerMinOrderAmt),
    minimumSingleOrderBaseUnits(options)
  );
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
    const unitRawLower = unitRawIn.toLowerCase();
    const legacyGram = unitRawLower === "gram" || unitRawLower === "g";
    const unit = normalizeUnitRaw(unitRawIn);
    const label = normalizeLabelForUnit(String(o.label ?? "").trim() || "Option", unitRawIn, unit);
    if (!Number.isFinite(price) || price <= 0) continue;
    const cap = parseCompareAt(o.compare_at_price);
    const row: ListingPriceOption = { id, label, price, unit };
    if (unit === "piece") {
      const bsRaw = o.bundle_size;
      const bs = bsRaw == null || bsRaw === "" ? 1 : Number(bsRaw);
      const n = Number.isFinite(bs) && bs >= 1 ? Math.floor(bs) : 1;
      row.bundle_size = n;
    } else if (unit === "kg") {
      const bsRaw = o.bundle_size;
      const bs = bsRaw == null || bsRaw === "" ? 1 : Number(bsRaw);
      let n: number;
      if (legacyGram) {
        const g = Number.isFinite(bs) && bs >= 1 ? bs : 1;
        n = Math.max(0.01, Math.round((g / 1000) * 1000) / 1000);
      } else {
        n = Number.isFinite(bs) && bs >= 0.01 ? Math.round(bs * 100) / 100 : 1;
      }
      row.bundle_size = n;
    }
    if (cap != null && cap > price) row.compare_at_price = cap;
    const pmin = o.preorder_price_min != null && o.preorder_price_min !== "" ? Number(o.preorder_price_min) : null;
    const pmax = o.preorder_price_max != null && o.preorder_price_max !== "" ? Number(o.preorder_price_max) : null;
    if (pmin != null && Number.isFinite(pmin) && pmin > 0) row.preorder_price_min = pmin;
    if (pmax != null && Number.isFinite(pmax) && pmax > 0) row.preorder_price_max = pmax;
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
    if (o.unit === "piece" && (o.bundle_size == null || !Number.isFinite(o.bundle_size) || o.bundle_size < 1)) {
      return {
        ok: false,
        message: "Each price row must include how many pieces that ₹ applies to (at least 1).",
      };
    }
    if (
      o.unit === "kg" &&
      (o.bundle_size == null || !Number.isFinite(o.bundle_size) || o.bundle_size < 0.01)
    ) {
      return {
        ok: false,
        message: "Each price row must include how many kg that ₹ applies to (at least 0.01 kg).",
      };
    }
    if (
      o.bundle_size != null &&
      o.unit === "piece" &&
      (!Number.isFinite(o.bundle_size) || o.bundle_size < 1)
    ) {
      return { ok: false, message: "Piece amounts must be a whole number of at least 1." };
    }
    if (o.bundle_size != null && o.unit === "piece" && Math.floor(o.bundle_size) !== o.bundle_size) {
      return { ok: false, message: "Piece amounts must be whole numbers." };
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

  const u0 = opts[0].unit;
  for (let i = 1; i < opts.length; i++) {
    if (opts[i].unit !== u0) {
      return {
        ok: false,
        message:
          "Every price row must use the same unit (all per piece or all per kg) so one stock number matches every order.",
      };
    }
  }

  return { ok: true, options: opts };
}

/** True when all tiers share one unit — required for `weight_avail` ↔ order quantity. */
export function pricingOptionsUniformUnit(options: ListingPriceOption[]): boolean {
  if (options.length === 0) return false;
  const u = options[0].unit;
  return options.every((o) => o.unit === u);
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
  // Return undefined (not a fallback) so callers can reject unknown option IDs.
  return opts.find((o) => o.id === optionId);
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

/** Short label for menus: ₹200 · Label */
export function formatOptionMenuLabel(opt: ListingPriceOption): string {
  return `₹${opt.price} · ${opt.label}`;
}

/**
 * Human-readable bundle size for buyer menus (matches seller “How many pieces/kg?”).
 * Per-base pricing → “Per piece” / “Per kg”. Fixed packs → “3 pieces”, “0.5 kg”.
 */
export function formatBundleSizeLead(o: ListingPriceOption): string {
  const perBase = isPerBaseUnitPricing(o);
  const amt = optionBundleAmount(o);
  if (o.unit === "piece") {
    if (perBase) return "Per piece";
    return `${Math.floor(amt)} pieces`;
  }
  if (perBase) return "Per kg";
  const r = Math.round(amt * 100) / 100;
  if (r > 0 && r < 1) {
    return `${Math.round(r * 1000)} grams`;
  }
  return `${r} kg`;
}

/**
 * One line for `<select>` options: bundle lead + ₹ + label (no redundant unit suffix).
 * Omits list/was price — the menu card below shows strikethrough and % off.
 * Caller must escape for HTML (e.g. wrap with `esc()` in Astro inline scripts).
 */
export function formatPriceOptionDropdownLabel(o: ListingPriceOption): string {
  const lead = formatBundleSizeLead(o);
  return `${lead} · ₹${o.price} — ${o.label}`;
}

/** Dashboard / home preview */
export function formatListingPriceSummary(listing: ListingPricingSource): string {
  const opts = getListingPriceOptions(listing);
  if (opts.length === 0) return "—";
  if (opts.length === 1) {
    const o = opts[0];
    const lead = formatBundleSizeLead(o);
    if (optionHasDealDisplay(o) && o.compare_at_price != null) {
      return `${lead} · ₹${o.price} — was ₹${o.compare_at_price}`;
    }
    return `${lead} · ₹${o.price}`;
  }
  const minP = Math.min(...opts.map((o) => o.price));
  return `From ₹${minP} · ${opts.length} options`;
}
