import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * GET /api/orders/payment-screenshots?order_id=&buyer_id=
 * Returns signed URLs for all payment screenshots the buyer uploaded.
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const order_id = url.searchParams.get("order_id");
    const buyer_id = url.searchParams.get("buyer_id");

    if (!order_id || !buyer_id) {
      return new Response(JSON.stringify({ error: "order_id and buyer_id required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("buyer_id, payment_screenshot_urls, payment_verified_at")
      .eq("id", order_id)
      .single();

    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
    }
    if (order.buyer_id !== buyer_id) {
      return new Response(JSON.stringify({ error: "Not your order" }), { status: 403 });
    }

    const paths: string[] = order.payment_screenshot_urls || [];
    if (paths.length === 0) {
      return new Response(JSON.stringify({ urls: [], verified: !!order.payment_verified_at }), { status: 200 });
    }

    const signed = await Promise.all(
      paths.map(async (path) => {
        const { data } = await supabase.storage.from("order-payments").createSignedUrl(path, 86400);
        return data?.signedUrl ?? null;
      })
    );

    return new Response(
      JSON.stringify({ urls: signed.filter(Boolean), verified: !!order.payment_verified_at }),
      { status: 200 }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
