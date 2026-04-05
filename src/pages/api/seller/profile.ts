import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * POST /api/seller/profile
 * Body: { seller_id, updates: { ... } }
 * Uses service_role key to bypass RLS
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { seller_id, updates } = await request.json();

    if (!seller_id || !updates) {
      return new Response(JSON.stringify({ error: "seller_id and updates required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from("sellers")
      .update(updates)
      .eq("id", seller_id)
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ seller: data }), { status: 200 });
  } catch (err: any) {
    console.error("Seller profile error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
