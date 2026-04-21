import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * GET /api/seller/payment-screenshot?order_id=&seller_id=&path=
 * Verifies seller owns the order, generates a fresh signed URL (1h expiry).
 * Path is a Supabase Storage path stored in orders.payment_screenshot_urls[].
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const order_id = url.searchParams.get("order_id");
    const seller_id = url.searchParams.get("seller_id");
    const path = url.searchParams.get("path");

    if (!order_id || !seller_id || !path) {
      return new Response(JSON.stringify({ error: "order_id, seller_id, and path required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify seller owns this order
    const { data: order } = await supabase
      .from("orders")
      .select("listing_id, seller_id, payment_screenshot_urls")
      .eq("id", order_id)
      .single();

    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
    }

    // Check via listing or direct seller_id
    let authorized = false;
    if (order.listing_id) {
      const { data: listing } = await supabase
        .from("fish_listings")
        .select("seller_id")
        .eq("id", order.listing_id)
        .single();
      authorized = listing?.seller_id === seller_id;
    } else if (order.seller_id) {
      authorized = order.seller_id === seller_id;
    }

    if (!authorized) {
      return new Response(JSON.stringify({ error: "Not your order" }), { status: 403 });
    }

    // Verify path is actually in the order's screenshot list (prevent path traversal)
    const urls: string[] = order.payment_screenshot_urls || [];
    if (!urls.includes(path)) {
      return new Response(JSON.stringify({ error: "Screenshot not found on this order" }), { status: 404 });
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from("order-payments")
      .createSignedUrl(path, 3600);

    if (signErr || !signed?.signedUrl) {
      return new Response(JSON.stringify({ error: signErr?.message || "Could not generate URL" }), { status: 500 });
    }

    return new Response(JSON.stringify({ url: signed.signedUrl }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
