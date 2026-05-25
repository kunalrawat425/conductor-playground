import type { APIRoute } from "astro";
import { supabase } from "../../lib/supabase";

// Full-text search across listings + sellers. Used by /v2/search page.
export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const lat = parseFloat(url.searchParams.get("lat") || "");
  const lng = parseFloat(url.searchParams.get("lng") || "");

  if (!q) {
    return new Response(
      JSON.stringify({ success: true, listings: [], sellers: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Detect high-intent fish shop / near me keyword queries
  const cleanQ = q.replace(/[^\w\s]/g, "").trim();
  const targetKeywords = [
    "best fish shop near me",
    "fish shop near me",
    "best fish shop",
    "fish shop",
    "fish store near me",
    "fish store",
    "best fish store",
    "fish market near me",
    "fish market",
    "fresh fish delivery mumbai",
    "fresh fish delivery",
    "seafood delivery",
    "near me"
  ];
  const isKeywordMatch = targetKeywords.some(kw => cleanQ.includes(kw)) || cleanQ === "fish" || cleanQ === "shop" || cleanQ === "store";

  const limit = isKeywordMatch ? 100 : Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);

  try {
    // Search fish_listings
    let listingsQuery = supabase
      .from("fish_listings")
      .select("id, species, pricing_options, photo_url, weight_avail, is_available, is_preorder_enabled, seller:sellers(id, name, location_name, lat, lng, opens_at, closes_at, accepts_preorder, has_delivery, rating_avg, total_orders, is_active)");

    if (isKeywordMatch) {
      listingsQuery = listingsQuery.or("is_available.eq.true,is_preorder_enabled.eq.true");
    } else {
      listingsQuery = listingsQuery.ilike("species", `%${q}%`).or("is_available.eq.true,is_preorder_enabled.eq.true");
    }

    const { data: listings } = await listingsQuery.limit(limit);

    // Filter: active seller; preorder listings only if min+max both set
    const validListings = (listings || []).filter((l: any) => {
      if (!l.seller?.is_active || l.seller?.name === "New Seller") return false;
      if (!l.is_available && l.is_preorder_enabled) return Array.isArray(l.pricing_options) && l.pricing_options.some((o: any) => o?.preorder_price_min || o?.preorder_price_max);
      return true;
    });

    // Search sellers
    let sellersQuery = supabase
      .from("sellers")
      .select("id, name, location_name, lat, lng, opens_at, closes_at, accepts_preorder, has_delivery, rating_avg, total_orders")
      .eq("is_active", true)
      .neq("name", "New Seller");

    if (isKeywordMatch) {
      // Fetch all active sellers to rank them
    } else {
      sellersQuery = sellersQuery.or(`name.ilike.%${q}%,location_name.ilike.%${q}%`);
    }

    const { data: sellers } = await sellersQuery.limit(limit);

    // Rank listings & sellers if we are handling a keyword fallback search
    let sortedListings = validListings || [];
    let sortedSellers = sellers || [];

    if (isKeywordMatch) {
      // Sort sellers: top rating first, then by orders
      sortedSellers = [...sortedSellers].sort((a: any, b: any) => {
        const ratingDiff = (Number(b.rating_avg) || 0) - (Number(a.rating_avg) || 0);
        if (Math.abs(ratingDiff) > 0.05) return ratingDiff;
        return (Number(b.total_orders) || 0) - (Number(a.total_orders) || 0);
      });

      // Sort listings: listings from top-rated sellers first
      sortedListings = [...sortedListings].sort((a: any, b: any) => {
        const aRating = Number(a.seller?.rating_avg) || 0;
        const bRating = Number(b.seller?.rating_avg) || 0;
        const ratingDiff = bRating - aRating;
        if (Math.abs(ratingDiff) > 0.05) return ratingDiff;
        const aOrders = Number(a.seller?.total_orders) || 0;
        const bOrders = Number(b.seller?.total_orders) || 0;
        return bOrders - aOrders;
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        query: q,
        isKeywordMatch,
        listings: sortedListings,
        sellers: sortedSellers,
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

