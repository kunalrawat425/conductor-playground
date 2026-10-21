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
    // Seller hours let a page that doesn't know the seller's mode (the cart sheet)
    // work out same-day vs pre-order the way the order API does.
    const cols = "id, seller_id, is_available, weight_avail, pricing_options, is_preorder_enabled, is_order_paused, deleted_at";
    const run = (c: string) => supabase.from("fish_listings").select(c).in("id", listing_ids);
    let { data, error } = await run(
      `${cols}, seller:sellers ( opens_at, closes_at, open_days, preorder_days, preorder_cutoff_time, preorder_opens_at, delivery_days, accepts_preorder )`
    );
    if (error) ({ data, error } = await run(cols));

    if (error) throw error;

    return new Response(JSON.stringify({ listings: data || [] }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
