import type { SupabaseClient } from "@supabase/supabase-js";
import { istDayStartISO } from "../order-timing";
import { sellerBlocked } from "../test-sellers";
import {
  getListingOptionById,
  getListingPriceOptions,
  optionBundleAmount,
  isPerBaseUnitPricing,
  minimumRequiredBuyerDailyCap,
  type ListingPricingSource,
} from "../listing-pricing";
import {
  classifyPlacementAtOrderTime,
  closedSellerMessage,
  isSellerEffectivelyOpen,
  type PlacementKind,
} from "../order-timing";


/** Resolved line that will use create_order_atomic / fallback insert (in-stock or low-stock path). */
export type StandardOrderLinePayload = {
  kind: "standard";
  placement_kind: PlacementKind;
  listing_id: string;
  species: string | null;
  seller_id: string;
  quantity: number;
  quantity_unit: string;
  total_price: number;
  pricing_option_id: string | null;
  pricing_label: string | null;
};

/** Pre-order window placement (no stock decrement at create). */
export type PreorderLinePayload = {
  kind: "preorder";
  placement_kind: "preorder";
  listing_id: string;
  species: string | null;
  seller_id: string;
  quantity: number;
  quantity_unit: string;
  total_price: number;
  pricing_option_id: string | null;
  pricing_label: string | null;
  pre_order_reason: "unavailable" | "out_of_stock";
  preorder_price_min?: number | null;
  preorder_price_max?: number | null;
};

export type ResolveListingOrderLineResult =
  | { ok: false; status: number; error: string }
  | { ok: true; line: StandardOrderLinePayload | PreorderLinePayload };

/**
 * Validates one listing line for checkout (same rules as POST /api/orders/create).
 * Placement kind follows seller hours + order time only (see order-timing.ts).
 */
export async function resolveListingOrderLine(
  supabase: SupabaseClient,
  input: {
    listing_id: string;
    pricing_option_id?: string | null;
    rawQuantity: number;
    buyer_phone: string;
    buyer_id?: string | null;
    nowMs?: number;
  }
): Promise<ResolveListingOrderLineResult> {
  const { listing_id, pricing_option_id: clientPricingOptionId, rawQuantity, buyer_phone, buyer_id, nowMs } =
    input;

  let quantity = typeof rawQuantity === "number" ? rawQuantity : parseFloat(String(rawQuantity));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, status: 400, error: "Invalid quantity" };
  }

  const { data: listing } = await supabase
    .from("fish_listings")
    .select(
      "pricing_options, seller_id, species, weight_avail, is_available, buyer_daily_qty_limit, oos_threshold, is_order_paused, is_preorder_enabled, deleted_at"
    )
    .eq("id", listing_id)
    .single();

  if (!listing || (listing as any).deleted_at) {
    return { ok: false, status: 404, error: "Listing not found" };
  }
  if ((listing as any).is_order_paused) {
    return { ok: false, status: 400, error: "The seller has paused orders for this item." };
  }

  // `*` so is_test is read when migration 071 has added it, and absent (falsy) before.
  const { data: seller } = await supabase
    .from("sellers")
    .select("*")
    .eq("id", listing.seller_id)
    .single();

  // Nothing checked seller status at order time: unapproved or deactivated
  // sellers took orders through direct links. Test sellers stay inactive
  // (hidden from every public list) but accept orders for QA — never on production.
  if (sellerBlocked(seller as any, (import.meta.env.VERCEL_ENV || process.env.VERCEL_ENV))) {
    return { ok: false, status: 400, error: "This seller is not taking orders right now." };
  }

  const placementResult = seller ? classifyPlacementAtOrderTime(seller, nowMs) : "same_day";
  if (placementResult === "closed") {
    return { ok: false, status: 400, error: seller ? closedSellerMessage(seller) : "Seller is not available." };
  }
  const placement: PlacementKind = placementResult;
  if (placement === "preorder" && (listing as any).is_preorder_enabled === false) {
    return { ok: false, status: 400, error: "This item is not available for pre-order." };
  }

  let chosen = getListingOptionById(listing as ListingPricingSource, clientPricingOptionId);
  if (!chosen) {
    return { ok: false, status: 400, error: "Invalid price option for this listing" };
  }
  // If the resolved option is a bundle option whose bundle_size doesn't divide the
  // requested quantity, try to find a better-matching option by quantity divisibility.
  // This handles stale cart entries that stored "default" before the opt_N fix.
  if (!isPerBaseUnitPricing(chosen)) {
    const rawQty = typeof input.rawQuantity === "number" ? input.rawQuantity : parseFloat(String(input.rawQuantity));
    if (Number.isFinite(rawQty) && rawQty > 0) {
      const qFloor = Math.floor(rawQty);
      const bAmt = optionBundleAmount(chosen);
      const fails = chosen.unit === "kg"
        ? Math.round(rawQty * 100) % Math.round(bAmt * 100) !== 0
        : qFloor % bAmt !== 0;
      if (fails) {
        const allOpts = getListingPriceOptions(listing as ListingPricingSource);
        const better = allOpts.find((o) => {
          if (isPerBaseUnitPricing(o)) return false;
          const b = optionBundleAmount(o);
          return o.unit === "kg"
            ? Math.round(rawQty * 100) % Math.round(b * 100) === 0
            : qFloor % b === 0;
        });
        if (better) chosen = better;
      }
    }
  }
  const orderPricingOptionId = chosen.id;
  const orderPricingLabel = chosen.label;
  let quantity_unit = chosen.unit;

  if (quantity_unit === "kg") {
    quantity = Math.round(Number(quantity) * 100) / 100;
  } else {
    quantity = Math.floor(Number(quantity));
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, status: 400, error: "Invalid quantity" };
  }

  const linePrice =
    placement === "preorder"
      ? chosen.preorder_price_max ?? chosen.preorder_price_min ?? chosen.price
      : chosen.price;
  const bundleAmount = optionBundleAmount(chosen);
  const perBase = isPerBaseUnitPricing(chosen);

  const skipBundleCheck = placement === "preorder";
  if (!perBase && !skipBundleCheck) {
    if (quantity_unit === "kg") {
      const qCent = Math.round(quantity * 100);
      const bCent = Math.round(bundleAmount * 100);
      if (bCent < 1 || qCent % bCent !== 0) {
        return {
          ok: false,
          status: 400,
          error: `Quantity must be a multiple of ${bundleAmount} kg for this price line (e.g. ${bundleAmount}, ${bundleAmount * 2}, …).`,
        };
      }
    } else if (quantity % bundleAmount !== 0) {
      return {
        ok: false,
        status: 400,
        error: `Quantity must be a multiple of ${bundleAmount} ${quantity_unit} for this pack (e.g. ${bundleAmount}, ${bundleAmount * 2}, …).`,
      };
    }
  }

  const bundleCount = perBase ? quantity : quantity / bundleAmount;
  if (!Number.isFinite(bundleCount) || bundleCount <= 0) {
    return { ok: false, status: 400, error: "Invalid quantity" };
  }

  const minOrderAmt = Number(seller?.min_order_amount) || 0;
  const pricingOpts = getListingPriceOptions(listing);
  const dailyCapFloor = minimumRequiredBuyerDailyCap(pricingOpts, minOrderAmt);

  if (
    placement === "same_day" &&
    listing.buyer_daily_qty_limit != null &&
    Number(listing.buyer_daily_qty_limit) > 0
  ) {
    const cap = Number(listing.buyer_daily_qty_limit);
    if (cap < dailyCapFloor) {
      return {
        ok: false,
        status: 400,
        error: `Per-buyer daily limit must be at least ${dailyCapFloor} ${quantity_unit} (covers at least one smallest pack and your seller minimum order ₹${minOrderAmt || 0}). Raise the limit on the listing or adjust pricing.`,
      };
    }
    // BUG-45: must be the IST day boundary, not the server's. setHours(0,0,0,0)
    // on a UTC server made the window run 05:30 IST -> 05:30 IST, so the cap
    // reset mid-morning and a buyer could take two full daily allowances
    // within one IST day.
    const todayStartISO = istDayStartISO();
    const { data: dayOrders } = await supabase
      .from("orders")
      .select("quantity, buyer_phone, buyer_id, status")
      .eq("listing_id", listing_id)
      .gte("created_at", todayStartISO);

    let usedToday = 0;
    for (const o of dayOrders || []) {
      if (o.status === "cancelled" || o.status === "declined") continue;
      const match = buyer_id
        ? o.buyer_id === buyer_id || o.buyer_phone === buyer_phone
        : o.buyer_phone === buyer_phone;
      if (match) usedToday += Number(o.quantity);
    }
    if (usedToday + quantity > cap) {
      return {
        ok: false,
        status: 400,
        error: `Daily limit for this item is ${cap} ${quantity_unit} per buyer (you already have ${usedToday} today).`,
      };
    }
  }

  const weightAvail = Number(listing.weight_avail);
  const availOk = Number.isFinite(weightAvail) ? weightAvail : 0;
  const speciesVal = (listing as { species?: string }).species ?? null;
  const sellerOpen = seller ? isSellerEffectivelyOpen(seller, nowMs) : false;

  if (placement === "same_day") {
    if (!listing.is_available || availOk <= 0 || availOk < quantity) {
      return {
        ok: false,
        status: 400,
        error: `Only ${availOk} ${quantity_unit} in stock. Reduce quantity or try again later.`,
      };
    }
    const pre_order_reason = !listing.is_available ? "unavailable" : "out_of_stock";
    const total_price = (chosen.price || 0) * bundleCount;
    return {
      ok: true,
      line: {
        kind: "standard",
        placement_kind: "same_day",
        listing_id,
        species: speciesVal,
        seller_id: listing.seller_id,
        quantity,
        quantity_unit,
        total_price,
        pricing_option_id: orderPricingOptionId,
        pricing_label: orderPricingLabel,
        bundle_size: bundleAmount,
        pre_order_reason,
        is_preorder_enabled: !!(listing as any).is_preorder_enabled,
        preorder_price_min: chosen.preorder_price_min,
        preorder_price_max: chosen.preorder_price_max,
      },
    };
  }

  // Pre-order shopping window — inventory-independent; sellerOpen should be false here
  if (sellerOpen) {
    return { ok: false, status: 400, error: "Use same-day checkout while the seller is open." };
  }

  const total_price = linePrice * bundleCount;
  return {
    ok: true,
    line: {
      kind: "preorder",
      placement_kind: "preorder",
      listing_id,
      species: speciesVal,
      seller_id: listing.seller_id,
      quantity,
      quantity_unit,
      total_price,
      pricing_option_id: orderPricingOptionId,
      pricing_label: orderPricingLabel,
      bundle_size: bundleAmount,
    },
  };
}

/** @deprecated Use PreorderLinePayload */
export type OosPreorderLinePayload = PreorderLinePayload & { pre_order_reason?: string };
