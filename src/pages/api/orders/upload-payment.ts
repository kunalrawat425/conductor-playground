import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { paymentProofReceivedEmailSeller } from "../../../lib/email-templates";

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
 * Stores a single path in orders.payment_screenshot_urls[].
 * Re-upload overrides previous screenshot (single-proof policy).
 * Sets status to pending_payment only if currently pending or pre_order; otherwise status is unchanged (e.g. confirmed + replace proof).
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

    const uploadAllowed = new Set([
      "pending",
      "pre_order",
      "pending_payment",
      "payment_required",
      "confirmed",
      "paid",
      "ready_for_pickup",
      "out_for_delivery",
      "scheduled",
    ]);
    if (!uploadAllowed.has(order.status)) {
      return new Response(
        JSON.stringify({ error: "Payment proof cannot be uploaded or updated for this order status." }),
        { status: 400 }
      );
    }

    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${Date.now()}.${ext}`;
    const path = `order-payments/${order_id}/${filename}`;

    const { error: uploadErr } = await supabase.storage
      .from("order-payments")
      .upload(path, file, { contentType: file.type || "image/jpeg" });

    if (uploadErr) {
      const msg = uploadErr.message || "Upload failed";
      if (/bucket .*not found/i.test(msg)) {
        return new Response(
          JSON.stringify({
            error: "Payment storage is not configured",
            error_code: "bucket_missing",
            hint: "Create Supabase Storage bucket `order-payments` (private) and retry.",
          }),
          { status: 500 }
        );
      }
      return new Response(JSON.stringify({ error: msg }), { status: 500 });
    }

    const existing: string[] = order.payment_screenshot_urls || [];
    // Single-proof policy: keep only latest screenshot path.
    // Remove older file(s) from storage when possible.
    if (existing.length > 0) {
      try {
        await supabase.storage.from("order-payments").remove(existing);
      } catch (_) {}
    }
    const updated = [path];

    // Only advance early-stage orders into proof-wait; keep confirmed / in-fulfillment statuses unchanged.
    const statusUpdate = ["pending", "pre_order"].includes(order.status) ? { status: "pending_payment" } : {};

    const { data: updatedOrder, error: updateErr } = await supabase
      .from("orders")
      .update({
        payment_screenshot_urls: updated,
        payment_verified_at: null,
        payment_verified_by: null,
        ...statusUpdate,
      })
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

    // Notify seller (email + push) that buyer uploaded payment screenshot
    try {
      const { data: fullOrder } = await supabase
        .from("orders")
        .select("species, listing_id, fish_listings(seller_id)")
        .eq("id", order_id)
        .single();
      const sellerId = (fullOrder as any)?.fish_listings?.seller_id;
      if (sellerId) {
        const species = String((fullOrder as any)?.species || "fish");
        const orderIdShort = order_id.slice(0, 8);
        const { data: seller } = await supabase.from("sellers").select("email, name").eq("id", sellerId).single();
        if (seller?.email) {
          await sendResendEmail(
            seller.email,
            `Payment screenshot received — ${species}`,
            paymentProofReceivedEmailSeller({ species, orderIdShort, sellerName: seller.name })
          );
        }
        const origin = new URL(request.url).origin;
        await fetch(`${origin}/api/notify-seller`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "payment_proof",
            seller_id: sellerId,
            species,
            order_id_short: orderIdShort,
          }),
        });
      }
    } catch (_) {}

    return new Response(JSON.stringify({ order: updatedOrder, url: signedData?.signedUrl ?? null, path }), { status: 200 });
  } catch (err: any) {
    console.error("upload-payment error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
