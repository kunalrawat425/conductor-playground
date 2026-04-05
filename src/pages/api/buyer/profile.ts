import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * POST /api/buyer/profile
 * Body: { buyer_id, updates: { first_name, last_name, email, ... } }
 * Uses service_role key to bypass RLS
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { buyer_id, updates } = await request.json();

    if (!buyer_id || !updates) {
      return new Response(JSON.stringify({ error: "buyer_id and updates required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from("buyers")
      .update(updates)
      .eq("id", buyer_id)
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ buyer: data }), { status: 200 });
  } catch (err: any) {
    console.error("Buyer profile error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/**
 * GET /api/buyer/profile?buyer_id=xxx
 * Fetch buyer profile
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const buyer_id = url.searchParams.get("buyer_id");
    if (!buyer_id) {
      return new Response(JSON.stringify({ error: "buyer_id required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from("buyers")
      .select("id, phone, first_name, last_name, email, location_name, created_at")
      .eq("id", buyer_id)
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ buyer: data }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
