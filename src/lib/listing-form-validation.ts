import type { ListingPriceOption } from "./listing-pricing";
import { validateListingPricingJson } from "./listing-pricing";
import type { PriceUnit } from "./species";

export type ValidatedListingForm = {
  weightAvail: number;
  buyerDaily: number | null;
  oosThreshold: number | null;
  pricingOptions: ListingPriceOption[];
};

/**
 * Server-agnostic validation for seller add/edit listing forms (dashboard).
 */
export function validateSellerListingForm(input: {
  species: string;
  weightAvailStr: string;
  pricingOptionsJson: string;
  buyerDailyStr: string;
  oosThresholdStr: string;
}): { ok: true; data: ValidatedListingForm } | { ok: false; message: string; focusId?: string } {
  const species = String(input.species ?? "").trim();
  if (!species) {
    return { ok: false, message: "Choose a species.", focusId: "species" };
  }

  const pricing = validateListingPricingJson(input.pricingOptionsJson || "[]");
  if (!pricing.ok) {
    return { ok: false, message: pricing.message, focusId: "listing-section-pricing" };
  }

  const firstUnit = pricing.options[0]?.unit ?? "piece";
  const wStr = String(input.weightAvailStr ?? "").trim();
  if (wStr === "") {
    return { ok: false, message: "Enter stock quantity.", focusId: "weight_avail" };
  }
  const weightAvail = parseFloat(wStr);
  if (!Number.isFinite(weightAvail)) {
    return { ok: false, message: "Stock must be a valid number.", focusId: "weight_avail" };
  }
  if (weightAvail < 0) {
    return { ok: false, message: "Stock cannot be negative.", focusId: "weight_avail" };
  }

  const stockErr = validateStockMatchesUnit(weightAvail, firstUnit);
  if (stockErr) {
    return { ok: false, message: stockErr, focusId: "weight_avail" };
  }

  const dailyRaw = String(input.buyerDailyStr ?? "").trim();
  let buyerDaily: number | null = null;
  if (dailyRaw !== "") {
    const d = parseFloat(dailyRaw);
    if (!Number.isFinite(d) || d < 1) {
      return { ok: false, message: "Daily limit must be at least 1, or leave it empty.", focusId: "buyer_daily_qty_limit" };
    }
    if (!Number.isInteger(d)) {
      return { ok: false, message: "Daily limit must be a whole number.", focusId: "buyer_daily_qty_limit" };
    }
    buyerDaily = d;
  }

  const oosRaw = String(input.oosThresholdStr ?? "").trim();
  let oosThreshold: number | null = null;
  if (oosRaw !== "") {
    const o = parseFloat(oosRaw);
    if (!Number.isFinite(o) || o < 0) {
      return { ok: false, message: "“Stock clearing soon” threshold must be 0 or higher, or leave empty.", focusId: "oos_threshold" };
    }
    if (!Number.isInteger(o)) {
      return { ok: false, message: "Use a whole number for the clearing-soon threshold.", focusId: "oos_threshold" };
    }
    oosThreshold = o;
  }

  if (oosThreshold != null && oosThreshold > weightAvail) {
    return {
      ok: false,
      message: "Clearing-soon threshold cannot be higher than current stock. Lower the threshold or increase stock.",
      focusId: "oos_threshold",
    };
  }

  return {
    ok: true,
    data: {
      weightAvail,
      buyerDaily,
      oosThreshold,
      pricingOptions: pricing.options,
    },
  };
}

function validateStockMatchesUnit(stock: number, unit: PriceUnit): string | null {
  if (unit === "kg") {
    if (stock > 1_000_000) return "Stock amount looks too large. Check kg vs grams.";
    return null;
  }
  if (unit === "piece" || unit === "dozen" || unit === "gram") {
    if (!Number.isInteger(stock)) {
      if (unit === "gram") {
        return "Stock in grams must be a whole number.";
      }
      return "Stock must be a whole number when selling by piece or dozen.";
    }
  }
  return null;
}

/** Scroll + focus a field after validation errors (call from dashboard scripts). */
export function focusListingField(focusId: string | undefined): void {
  if (!focusId) return;
  requestAnimationFrame(() => {
    const el = document.getElementById(focusId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    }
  });
}
