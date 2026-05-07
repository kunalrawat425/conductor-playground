import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { order_id, buyer_id, rating, feedback } = await request.json();
    const numericRating = Number(rating);
    const safeFeedback = typeof feedback === "string" ? feedback.slice(0, 500) : "";

    if (!order_id || !buyer_id) {
      return new Response(JSON.stringify({ error: "order_id and buyer_id required" }), { status: 400 });
    }
    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
      return new Response(JSON.stringify({ error: "rating must be between 1 and 5" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, buyer_id, buyer_phone, status, listing:fish_listings(seller_id)")
      .eq("id", order_id)
      .single();

    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
    }

    if (!["completed", "picked_up"].includes(order.status)) {
      return new Response(JSON.stringify({ error: "Rating allowed only after delivery/pickup" }), { status: 400 });
    }

    if (order.buyer_id !== buyer_id) {
      const { data: buyer } = await supabase.from("buyers").select("phone").eq("id", buyer_id).single();
      if (!buyer || buyer.phone !== order.buyer_phone) {
        return new Response(JSON.stringify({ error: "Not your order" }), { status: 403 });
      }
    }

    const sellerId = (order as any)?.listing?.seller_id as string | undefined;
    if (!sellerId) {
      return new Response(JSON.stringify({ error: "Seller not found for this order" }), { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const { error: feedbackErr } = await supabase
      .from("order_feedback")
      .upsert(
        {
          order_id,
          buyer_id,
          seller_id: sellerId,
          rating: numericRating,
          feedback: safeFeedback,
          updated_at: nowIso,
        },
        { onConflict: "order_id,buyer_id" }
      );

    if (feedbackErr) {
      return new Response(JSON.stringify({ error: feedbackErr.message }), { status: 500 });
    }

    const { data: ratings, error: ratingsErr } = await supabase
      .from("order_feedback")
      .select("rating")
      .eq("seller_id", sellerId);

    if (!ratingsErr && ratings && ratings.length > 0) {
      const sum = ratings.reduce((acc: number, row: any) => acc + (Number(row.rating) || 0), 0);
      const avg = Number((sum / ratings.length).toFixed(2));
      await supabase.from("sellers").update({ rating_avg: avg }).eq("id", sellerId);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        feedback: {
          rating: numericRating,
          feedback: safeFeedback,
          updated_at: nowIso,
        },
      }),
      { status: 200 }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Failed to save feedback" }), { status: 500 });
  }
};

