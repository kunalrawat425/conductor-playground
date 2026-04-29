import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * GET /api/seller/fulfillment?seller_id=uuid
 * Public fulfillment flags for buyer checkout (no PII).
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const seller_id = url.searchParams.get("seller_id");
    if (!seller_id) {
      return new Response(JSON.stringify({ error: "seller_id required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase
      .from("sellers")
      .select("has_pickup, has_delivery")
      .eq("id", seller_id)
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    if (!data) {
      return new Response(JSON.stringify({ error: "Seller not found" }), { status: 404 });
    }

    return new Response(
      JSON.stringify({
        has_pickup: data.has_pickup !== false,
        has_delivery: !!data.has_delivery,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("seller/fulfillment:", err);
    return new Response(JSON.stringify({ error: err?.message || "Error" }), { status: 500 });
  }
};
