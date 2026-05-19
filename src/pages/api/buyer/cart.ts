import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

function client() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * GET /api/buyer/cart?buyer_id=
 * Returns cart items joined with listing + seller info.
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const buyer_id = url.searchParams.get("buyer_id");
    if (!buyer_id) return new Response(JSON.stringify({ error: "buyer_id required" }), { status: 400 });

    const supabase = client();
    const { data, error } = await supabase
      .from("buyer_cart")
      .select(`
        listing_id,
        qty,
        qty_unit,
        price_snapshot,
        created_at,
        updated_at,
        listing:fish_listings ( id, species, photo_url, weight_avail, is_available, pricing_options, seller_id, seller:sellers ( id, name, store_image_url, is_active, opens_at, closes_at, has_delivery, accepts_preorder, min_order_amount ) )
      `)
      .eq("buyer_id", buyer_id)
      .order("updated_at", { ascending: false });

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    const items = (data || []).map((r: any) => ({
      listing_id: r.listing_id,
      qty: Number(r.qty),
      qty_unit: r.qty_unit,
      price_snapshot: Number(r.price_snapshot),
      created_at: r.created_at,
      updated_at: r.updated_at,
      seller_id: r.listing?.seller_id,
      seller_name: r.listing?.seller?.name || "",
      seller_image_url: r.listing?.seller?.store_image_url || null,
      seller_active: !!r.listing?.seller?.is_active,
      species: r.listing?.species,
      species_display: r.listing?.species,
      photo_url: r.listing?.photo_url,
      weight_avail: r.listing?.weight_avail,
      is_available: r.listing?.is_available,
      accepts_preorder: !!r.listing?.seller?.accepts_preorder,
      has_delivery: !!r.listing?.seller?.has_delivery,
      min_order_amount: r.listing?.seller?.min_order_amount || 0,
    }));

    return new Response(JSON.stringify({ items }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/**
 * POST /api/buyer/cart
 * Body: { buyer_id, listing_id, qty, qty_unit, price_snapshot }
 * Upserts a cart line.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { buyer_id, listing_id, qty, qty_unit, price_snapshot } = body || {};
    if (!buyer_id || !listing_id) {
      return new Response(JSON.stringify({ error: "buyer_id and listing_id required" }), { status: 400 });
    }
    const qtyNum = Number(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      return new Response(JSON.stringify({ error: "qty must be > 0" }), { status: 400 });
    }

    const supabase = client();
    // Verify listing exists (defensive — protects FK + gives nicer error)
    const { data: listing, error: lErr } = await supabase
      .from("fish_listings")
      .select("id, seller_id, is_available")
      .eq("id", listing_id)
      .single();
    if (lErr || !listing) {
      return new Response(JSON.stringify({ error: "Listing not found" }), { status: 404 });
    }

    const row = {
      buyer_id,
      listing_id,
      qty: qtyNum,
      qty_unit: String(qty_unit || "kg"),
      price_snapshot: Number(price_snapshot) || 0,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("buyer_cart")
      .upsert(row, { onConflict: "buyer_id,listing_id" })
      .select()
      .single();

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ item: data }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/**
 * DELETE /api/buyer/cart?buyer_id=&listing_id=   (remove single item)
 * DELETE /api/buyer/cart?buyer_id=&seller_id=    (clear all items from a seller)
 * DELETE /api/buyer/cart?buyer_id=&clear=true    (wipe entire cart)
 */
export const DELETE: APIRoute = async ({ url }) => {
  try {
    const buyer_id = url.searchParams.get("buyer_id");
    const listing_id = url.searchParams.get("listing_id");
    const seller_id = url.searchParams.get("seller_id");
    const clear = url.searchParams.get("clear") === "true";

    if (!buyer_id) return new Response(JSON.stringify({ error: "buyer_id required" }), { status: 400 });

    const supabase = client();

    if (listing_id) {
      const { error } = await supabase
        .from("buyer_cart")
        .delete()
        .eq("buyer_id", buyer_id)
        .eq("listing_id", listing_id);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (seller_id) {
      // Remove all rows whose listing belongs to seller
      const { data: listings } = await supabase.from("fish_listings").select("id").eq("seller_id", seller_id);
      const ids = (listings || []).map((l: any) => l.id);
      if (ids.length === 0) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      const { error } = await supabase
        .from("buyer_cart")
        .delete()
        .eq("buyer_id", buyer_id)
        .in("listing_id", ids);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (clear) {
      const { error } = await supabase.from("buyer_cart").delete().eq("buyer_id", buyer_id);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: "listing_id, seller_id, or clear=true required" }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
