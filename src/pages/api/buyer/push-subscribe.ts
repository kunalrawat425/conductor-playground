import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * POST /api/buyer/push-subscribe
 * Body: { buyer_id, subscription } — subscription is null to unsubscribe
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { buyer_id, subscription } = await request.json();

    if (!buyer_id) {
      return new Response(JSON.stringify({ error: "Missing buyer_id" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error } = await supabase
      .from("buyers")
      .update({
        push_subscription: subscription || null,
        push_enabled: !!subscription,
      })
      .eq("id", buyer_id);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
