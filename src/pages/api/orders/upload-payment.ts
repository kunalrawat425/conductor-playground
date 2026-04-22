import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

async function sendResendEmail(to: string, subject: string, html: string) {
  if (!resendApiKey || !to?.includes("@")) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "Relifish <noreply@relifish.store>", to, subject, html }),
    });
  } catch (_) {}
}

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

    const existing: string[] = order.payment_screenshot_urls || [];
    const updated = [...existing, path];

    const statusUpdate = ["pending", "pre_order"].includes(order.status) ? { status: "pending_payment" } : {};

    const { data: updatedOrder, error: updateErr } = await supabase
      .from("orders")
      .update({ payment_screenshot_urls: updated, updated_at: new Date().toISOString(), ...statusUpdate })
      .eq("id", order_id)
      .select()
      .single();

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), { status: 500 });
    }

    // Generate fresh signed URL for immediate display (path stored in DB for re-generation)
    const { data: signedData } = await supabase.storage
      .from("order-payments")
      .createSignedUrl(path, 86400);

    // Notify seller that buyer uploaded payment screenshot
    try {
      const { data: fullOrder } = await supabase
        .from("orders")
        .select("species, listing_id, fish_listings(seller_id)")
        .eq("id", order_id)
        .single();
      const sellerId = (fullOrder as any)?.fish_listings?.seller_id;
      if (sellerId) {
        const { data: seller } = await supabase.from("sellers").select("email, name").eq("id", sellerId).single();
        if (seller?.email) {
          const species = (fullOrder as any)?.species || "fish";
          await sendResendEmail(
            seller.email,
            `Payment screenshot received — ${species}`,
            `<p>Hi ${seller.name || "there"},</p><p>A buyer has uploaded a payment screenshot for order <strong>${order_id.slice(0, 8).toUpperCase()}</strong> (${species}). Please review it in your <a href="https://www.relifish.store/v2/dashboard/orders">seller dashboard</a> and verify the payment.</p>`
          );
        }
      }
    } catch (_) {}

    return new Response(JSON.stringify({ order: updatedOrder, url: signedData?.signedUrl ?? null, path }), { status: 200 });
  } catch (err: any) {
    console.error("upload-payment error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
