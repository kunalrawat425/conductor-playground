import type { APIRoute } from "astro";
import { supabase } from "../../lib/supabase";

// Full-text search across listings + sellers. Used by /v2/search page.
export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const lat = parseFloat(url.searchParams.get("lat") || "");
  const lng = parseFloat(url.searchParams.get("lng") || "");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);

  if (!q) {
    return new Response(
      JSON.stringify({ success: true, listings: [], sellers: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // Search fish_listings by species (ILIKE on text + species code)
    const { data: listings } = await supabase
      .from("fish_listings")
      .select("id, species, pricing_options, photo_url, weight_avail, is_available, is_preorder_enabled, preorder_price_min, preorder_price_max, seller:sellers(id, name, location_name, lat, lng, opens_at, closes_at, accepts_preorder, has_delivery, rating_avg, is_active)")
      .ilike("species", `%${q}%`)
      .or("is_available.eq.true,is_preorder_enabled.eq.true")
      .limit(limit);

    // Filter: active seller; preorder listings only if min+max both set
    const validListings = (listings || []).filter((l: any) => {
      if (!l.seller?.is_active || l.seller?.name === "New Seller") return false;
      if (!l.is_available && l.is_preorder_enabled) return !!(l.preorder_price_min && l.preorder_price_max);
      return true;
    });

    // Search sellers by name (also ILIKE on location_name)
    const { data: sellers } = await supabase
      .from("sellers")
      .select("id, name, location_name, lat, lng, opens_at, closes_at, accepts_preorder, has_delivery, rating_avg")
      .eq("is_active", true)
      .neq("name", "New Seller")
      .or(`name.ilike.%${q}%,location_name.ilike.%${q}%`)
      .limit(limit);

    return new Response(
      JSON.stringify({
        success: true,
        query: q,
        listings: validListings,
        sellers: sellers || [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Search failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const prerender = false;
