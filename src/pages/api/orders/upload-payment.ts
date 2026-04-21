import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * POST /api/orders/upload-payment
 * Multipart form: { order_id, buyer_id, file }
 * Uploads payment screenshot to order-payments/{order_id}/{filename}
 * Appends URL to orders.payment_screenshot_urls[]
 * Sets status to pending_payment if currently pending.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const form = await request.formData();
    const order_id = form.get("order_id")?.toString();
    const buyer_id = form.get("buyer_id")?.toString();
    const file = form.get("file") as File | null;

    if (!order_id || !buyer_id || !file) {
      return new Response(JSON.stringify({ error: "order_id, buyer_id, and file required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify order belongs to this buyer
    const { data: order } = await supabase
      .from("orders")
      .select("buyer_id, status, payment_screenshot_urls")
      .eq("id", order_id)
      .single();

    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
    }
    if (order.buyer_id !== buyer_id) {
      return new Response(JSON.stringify({ error: "Not your order" }), { status: 403 });
    }

    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${Date.now()}.${ext}`;
    const path = `order-payments/${order_id}/${filename}`;

    const { error: uploadErr } = await supabase.storage
      .from("order-payments")
      .upload(path, file, { contentType: file.type || "image/jpeg" });

    if (uploadErr) {
      return new Response(JSON.stringify({ error: uploadErr.message }), { status: 500 });
    }

    // Get signed URL (24h expiry) — bucket is private
    const { data: signedData, error: signErr } = await supabase.storage
      .from("order-payments")
      .createSignedUrl(path, 86400);

    if (signErr || !signedData) {
      return new Response(JSON.stringify({ error: "Upload succeeded but URL generation failed" }), { status: 500 });
    }

    const existing: string[] = order.payment_screenshot_urls || [];
    const updated = [...existing, signedData.signedUrl];

    const statusUpdate = order.status === "pending" ? { status: "pending_payment" } : {};

    const { data: updatedOrder, error: updateErr } = await supabase
      .from("orders")
      .update({ payment_screenshot_urls: updated, updated_at: new Date().toISOString(), ...statusUpdate })
      .eq("id", order_id)
      .select()
      .single();

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ order: updatedOrder, url: signedData.signedUrl }), { status: 200 });
  } catch (err: any) {
    console.error("upload-payment error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
