import type { APIRoute } from "astro";
import { sendBuyerOrderPush } from "../../lib/server/buyer-push";

export const prerender = false;

/**
 * POST /api/push-notify
 * Body: { buyer_id?, buyer_phone?, status, species, final_price }
 * Manual testing / external callers; order flow uses sendBuyerOrderPush directly.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { buyer_id, buyer_phone, status, species, final_price, order_id } = body;

    const result = await sendBuyerOrderPush({
      buyer_id,
      buyer_phone,
      status,
      species,
      final_price,
      order_id,
    });

    if (!result.ok) {
      const statusCode = result.error === "VAPID keys not configured" ? 500 : 400;
      return new Response(JSON.stringify({ error: result.error }), {
        status: statusCode,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!result.sent) {
      return new Response(JSON.stringify({ skipped: true, reason: result.reason }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Push notify error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
