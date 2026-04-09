import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { canonicalPricingOptionsFromPayload } from "../../../lib/listing-pricing";

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
      const {
        pricing_options: _raw,
        price: _legacyPrice,
        price_unit: _legacyUnit,
        ...rest
      } = listing as Record<string, unknown>;

      const { data, error } = await supabase
        .from("fish_listings")
        .insert({
          ...rest,
          seller_id,
          pricing_options: tiers,
        })
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

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400 });
  } catch (err: any) {
    console.error("Seller listings error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
