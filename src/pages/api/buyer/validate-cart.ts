import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

function client() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const { listing_ids } = await request.json();
    if (!Array.isArray(listing_ids) || listing_ids.length === 0) {
      return new Response(JSON.stringify({ listings: [] }), { status: 200 });
    }

    const supabase = client();
    const { data, error } = await supabase
      .from("fish_listings")
      .select("id, is_available, weight_avail, pricing_options, is_preorder_enabled")
      .in("id", listing_ids);

    if (error) throw error;

    return new Response(JSON.stringify({ listings: data || [] }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
