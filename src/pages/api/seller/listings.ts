import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { canonicalPricingOptionsFromPayload, pricingOptionsUniformUnit } from "../../../lib/listing-pricing";
import { assertSellerOwns } from "../../../lib/server/assert-seller";
import { SPECIES } from "../../../lib/species";

// Fields a seller may set on their own listing. The body used to be spread
// into insert/update, so a seller could set id / deleted_at / seller_id (moving
// a listing to another seller), and any species string — which flows unescaped
// into JSON-LD and the /shop category strip (stored XSS).
const LISTING_EDITABLE = [
  "species", "fish_size", "pricing_options", "weight_avail", "photo_url", "listed_date",
  "is_available", "pickup_loc", "buyer_daily_qty_limit", "oos_threshold",
  "is_preorder_enabled", "is_order_paused",
] as const;

function pickListingFields(src: Record<string, unknown>): { row?: Record<string, unknown>; error?: string } {
  const row: Record<string, unknown> = {};
  for (const k of LISTING_EDITABLE) {
    if (Object.prototype.hasOwnProperty.call(src, k)) row[k] = src[k];
  }
  if (row.species !== undefined && !Object.prototype.hasOwnProperty.call(SPECIES, String(row.species))) {
    return { error: "Unknown species" };
  }
  for (const k of ["weight_avail", "buyer_daily_qty_limit", "oos_threshold"]) {
    if (row[k] == null) continue;
    const n = Number(row[k]);
    if (!Number.isFinite(n) || n < 0) return { error: `${k} must be a non-negative number` };
    row[k] = n;
  }
  return { row };
}

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * POST /api/seller/listings
 * Body: { action: "create" | "update" | "delete", seller_id, seller_phone, listing?, listing_id?, updates? }
 * Uses service_role key to bypass RLS (seller auth is localStorage-based, not Supabase Auth).
 * BUG-12: seller_phone required — seller_id alone is publicly exposed via /api/search.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action, seller_id, seller_phone } = body;

    const authCheck = await assertSellerOwns(seller_id, seller_phone, request);
    if (authCheck instanceof Response) return authCheck;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (action === "create") {
      const { listing } = body;
      if (!listing) {
        return new Response(JSON.stringify({ error: "listing data required" }), { status: 400 });
      }

      const tiers = canonicalPricingOptionsFromPayload(listing.pricing_options);
      if (!tiers || tiers.some((t) => t.price < 1)) {
        return new Response(
          JSON.stringify({
            error:
              "pricing_options must include at least one valid tier with price at least ₹1 per tier.",
          }),
          { status: 400 }
        );
      }
      if (tiers.length > 3) {
        return new Response(
          JSON.stringify({ error: "Maximum 3 price tiers allowed per listing." }),
          { status: 400 }
        );
      }
      if (!pricingOptionsUniformUnit(tiers)) {
        return new Response(
          JSON.stringify({
            error:
              "All pricing tiers must use the same unit (piece or kg) so inventory matches orders.",
          }),
          { status: 400 }
        );
      }
      const picked = pickListingFields(listing as Record<string, unknown>);
      if (picked.error) {
        return new Response(JSON.stringify({ error: picked.error }), { status: 400 });
      }
      if (!picked.row!.species) {
        return new Response(JSON.stringify({ error: "species required" }), { status: 400 });
      }
      const insertRow: Record<string, unknown> = {
        ...picked.row,
        seller_id,
        pricing_options: tiers,
      };

      const { data, error } = await supabase
        .from("fish_listings")
        .insert(insertRow)
        .select()
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      }
      return new Response(JSON.stringify({ listing: data }), { status: 201 });
    }

    if (action === "update") {
      const { listing_id, updates } = body;
      if (!listing_id || !updates) {
        return new Response(JSON.stringify({ error: "listing_id and updates required" }), { status: 400 });
      }

      // Verify listing belongs to seller
      const { data: existing } = await supabase
        .from("fish_listings")
        .select("seller_id")
        .eq("id", listing_id)
        .single();

      if (!existing || existing.seller_id !== seller_id) {
        return new Response(JSON.stringify({ error: "Not your listing" }), { status: 403 });
      }

      const picked = pickListingFields(updates as Record<string, unknown>);
      if (picked.error) {
        return new Response(JSON.stringify({ error: picked.error }), { status: 400 });
      }
      let patch = picked.row!;
      if (Object.prototype.hasOwnProperty.call(patch, "pricing_options")) {
        const tiers = canonicalPricingOptionsFromPayload(patch.pricing_options);
        if (!tiers || tiers.some((t) => t.price < 1)) {
          return new Response(
            JSON.stringify({
              error:
                "pricing_options must include at least one valid tier with price at least ₹1 per tier.",
            }),
            { status: 400 }
          );
        }
        if (!pricingOptionsUniformUnit(tiers)) {
          return new Response(
            JSON.stringify({
              error:
                "All pricing tiers must use the same unit (piece or kg) so inventory matches orders.",
            }),
            { status: 400 }
          );
        }
        patch = { ...patch, pricing_options: tiers };
      }

      const { data, error } = await supabase
        .from("fish_listings")
        .update(patch)
        .eq("id", listing_id)
        .select()
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      }
      return new Response(JSON.stringify({ listing: data }), { status: 200 });
    }

    if (action === "delete") {
      const { listing_id } = body;
      if (!listing_id) {
        return new Response(JSON.stringify({ error: "listing_id required" }), { status: 400 });
      }
      // Verify listing belongs to seller
      const { data: existing } = await supabase
        .from("fish_listings")
        .select("seller_id")
        .eq("id", listing_id)
        .single();
      if (!existing || existing.seller_id !== seller_id) {
        return new Response(JSON.stringify({ error: "Not your listing" }), { status: 403 });
      }
      // Soft-delete. is_preorder_enabled must go off too: it used to stay true,
      // so deleted listings kept appearing in pre-order menus and stayed orderable.
      const { error } = await supabase.from("fish_listings").update({
        is_available: false,
        weight_avail: 0,
        is_preorder_enabled: false,
        deleted_at: new Date().toISOString(),
      }).eq("id", listing_id);
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
  } catch (err: any) {
    console.error("Seller listings error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
