import type { APIRoute } from "astro";
import { supabase } from "../../lib/supabase";

// Buyer's pre-order status orders that need price acceptance or are awaiting fulfillment.
// Used by /v2/track to show live pre-order stepper.
export const GET: APIRoute = async ({ url }) => {
  const buyerId = url.searchParams.get("buyer_id");
  const phone = url.searchParams.get("phone");

  if (!buyerId && !phone) {
    return new Response(
      JSON.stringify({ error: "buyer_id or phone required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    let query = supabase
      .from("orders")
      .select("*, listing:fish_listings(species, seller:sellers(id, name, phone))")
      .in("status", ["pre_order", "scheduled"])
      .order("created_at", { ascending: false });

    if (buyerId) query = query.eq("buyer_id", buyerId);
    else if (phone) query = query.eq("buyer_phone", phone);

    const { data, error } = await query;
    if (error) throw error;

    // Split: awaiting price acceptance vs awaiting fulfillment
    const awaitingAccept = (data || []).filter((o: any) => o.final_price && o.status === "pre_order");
    const awaitingFulfill = (data || []).filter((o: any) => !o.final_price);

    return new Response(
      JSON.stringify({
        success: true,
        awaiting_accept: awaitingAccept,
        awaiting_fulfill: awaitingFulfill,
        total: data?.length || 0,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Failed to load pre-orders" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const prerender = false;
