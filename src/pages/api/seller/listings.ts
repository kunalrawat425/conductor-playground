import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { canonicalPricingOptionsFromPayload, pricingOptionsUniformUnit } from "../../../lib/listing-pricing";
import { verifyToken } from "../../../lib/server/auth-token";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * POST /api/seller/listings
 * Body: { action: "create" | "update" | "delete", seller_id, listing?, listing_id?, updates? }
 * Uses service_role key to bypass RLS (seller auth is localStorage-based, not Supabase Auth)
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action, seller_id } = body;

    if (!seller_id) {
      return new Response(JSON.stringify({ error: "seller_id required" }), { status: 400 });
    }
    if (!verifyToken(request.headers.get("x-seller-token"), seller_id, "seller")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify seller exists
    const { data: seller } = await supabase
      .from("sellers")
      .select("id")
      .eq("id", seller_id)
      .single();

    if (!seller) {
      return new Response(JSON.stringify({ error: "Seller not found" }), { status: 404 });
    }

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
      if (!pricingOptionsUniformUnit(tiers)) {
        return new Response(
          JSON.stringify({
            error:
              "All pricing tiers must use the same unit (piece or kg) so inventory matches orders.",
          }),
          { status: 400 }
        );
      }
      const {
        pricing_options: _raw,
        price: _legacyPrice,
        price_unit: _legacyUnit,
        ...rest
      } = listing as Record<string, unknown>;

      const insertRow: Record<string, unknown> = {
        ...rest,
        seller_id,
        pricing_options: tiers,
      };
      if (insertRow.weight_avail != null) {
        insertRow.weight_avail = Number(insertRow.weight_avail);
      }

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

      let patch = { ...updates } as Record<string, unknown>;
      delete patch.price;
      delete patch.price_unit;
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
        patch = { ...patch, pricing_options: tiers };
      }

      if (Object.prototype.hasOwnProperty.call(patch, "weight_avail") && patch.weight_avail != null) {
        patch = { ...patch, weight_avail: Number(patch.weight_avail) };
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
      // Soft-delete: flip is_available off + zero stock. Try setting deleted_at if column
      // exists (migration 035); gracefully fallback without it.
      const updates: Record<string, any> = { is_available: false, weight_avail: 0 };
      try { updates.deleted_at = new Date().toISOString(); } catch {}
      const { error: e1 } = await supabase.from("fish_listings").update(updates).eq("id", listing_id);
      // If deleted_at column doesn't exist, retry without it
      const error = (e1 && e1.message?.includes("deleted_at"))
        ? (await supabase.from("fish_listings").update({ is_available: false, weight_avail: 0 }).eq("id", listing_id)).error
        : e1;
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
