import type { SupabaseClient } from "@supabase/supabase-js";
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

/** Resolved line that will use create_order_atomic / fallback insert (in-stock same-day path). */
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
      "pricing_options, seller_id, species, weight_avail, is_available, buyer_daily_qty_limit, oos_threshold"
    )
    .eq("id", listing_id)
    .single();

  if (!listing) {
    return { ok: false, status: 404, error: "Listing not found" };
  }

  const { data: seller } = await supabase
    .from("sellers")
    .select(
      "opens_at, closes_at, accepts_preorder, open_days, preorder_days, preorder_cutoff_time, min_order_amount"
    )
    .eq("id", listing.seller_id)
    .single();

  if (!seller) {
    return { ok: false, status: 404, error: "Seller not found" };
  }

  const placement = classifyPlacementAtOrderTime(seller, nowMs);
  if (placement === "closed") {
    return { ok: false, status: 400, error: closedSellerMessage(seller) };
  }

  const chosen = getListingOptionById(listing as ListingPricingSource, clientPricingOptionId);
  if (!chosen) {
    return { ok: false, status: 400, error: "Invalid price option for this listing" };
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

  const minOrderAmt = Number(seller.min_order_amount) || 0;
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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: dayOrders } = await supabase
      .from("orders")
      .select("quantity, buyer_phone, buyer_id, status")
      .eq("listing_id", listing_id)
      .gte("created_at", todayStart.toISOString());

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
  const sellerOpen = isSellerEffectivelyOpen(seller, nowMs);

  if (placement === "same_day") {
    if (!listing.is_available || availOk <= 0 || availOk < quantity) {
      return {
        ok: false,
        status: 400,
        error: `Only ${availOk} ${quantity_unit} in stock. Reduce quantity or try again later.`,
      };
    }
    const total_price = linePrice * bundleCount;
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
    },
  };
}

/** @deprecated Use PreorderLinePayload */
export type OosPreorderLinePayload = PreorderLinePayload & { pre_order_reason?: string };
