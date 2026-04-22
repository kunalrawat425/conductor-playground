import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * POST /api/seller/upload-refund (multipart: order_id, seller_id, file)
 * Uploads seller's UPI refund proof screenshot.
 * Stores path in orders.refund_screenshot_path.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const form = await request.formData();
    const order_id = form.get("order_id")?.toString();
    const seller_id = form.get("seller_id")?.toString();
    const file = form.get("file") as File | null;

    if (!order_id || !seller_id || !file) {
      return new Response(JSON.stringify({ error: "order_id, seller_id, and file required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify seller owns this order
    const { data: order } = await supabase
      .from("orders")
      .select("listing_id, seller_id, status")
      .eq("id", order_id)
      .single();

    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
    }

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

    if (file.size > 5 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "File too large (max 5 MB)" }), { status: 400 });
    }

    const ext = file.name.split(".").pop() || "jpg";
    const path = `order-payments/${order_id}/refund-${Date.now()}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("order-payments")
      .upload(path, file, { contentType: file.type || "image/jpeg" });

    if (uploadErr) {
      return new Response(JSON.stringify({ error: uploadErr.message }), { status: 500 });
    }

    await supabase
      .from("orders")
      .update({ refund_screenshot_path: path })
      .eq("id", order_id);

    const { data: signed } = await supabase.storage
      .from("order-payments")
      .createSignedUrl(path, 3600);

    return new Response(JSON.stringify({ path, url: signed?.signedUrl ?? null }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
