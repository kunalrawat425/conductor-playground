import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { requireBuyer } from "../../../lib/server/session";
import { loadPayableCartRows, rowPaise } from "../../../lib/server/order-cart";
import { isOpenPodOrder, podBlockReason, POD_REFUSED_REASON, POD_REFUSAL_DAYS, type PodBlock } from "../../../lib/pay-on-delivery";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

const ROW_COLS = "id, buyer_id, cart_id, status, total_price, delivery_fee, razorpay_order_id, razorpay_payment_id, created_at, pay_on_delivery, final_price, listing_id";

/**
 * Pay on delivery (founder, 6 Nov 2026): after "Place order" the buyer may pay in the app when the
 * fish arrives instead of now. Never cash.
 *   GET  ?order_id&buyer_id → { eligible, amount, block? } for the order page
 *   POST { order_id, buyer_id } → puts the whole checkout on pay on delivery and tells the seller
 */
async function check(request: Request, order_id: string | null, buyer_id: string | null) {
  { const denied = requireBuyer(request, buyer_id); if (denied) return { response: denied }; }
  if (!order_id) return { response: new Response(JSON.stringify({ error: "order_id required" }), { status: 400 }) };
  const sb = createClient(supabaseUrl, supabaseServiceKey);
  const { data: order } = await sb.from("orders").select(ROW_COLS).eq("id", order_id).eq("buyer_id", buyer_id).maybeSingle();
  if (!order) return { response: new Response(JSON.stringify({ error: "Order not found" }), { status: 404 }) };

  // Rows of this checkout still waiting for their first payment (never a balance top-up).
  const rows = (await loadPayableCartRows(sb, order as any, ROW_COLS)).filter((r: any) => ["pending", "pending_payment"].includes(r.status) && !r.razorpay_payment_id);
  const total = rows.reduce((sum: number, r: any) => sum + rowPaise(r), 0) / 100;

  const { data: listing } = await sb.from("fish_listings").select("seller:sellers(accepts_pay_on_delivery)").eq("id", (order as any).listing_id).maybeSingle();
  const since = new Date(Date.now() - POD_REFUSAL_DAYS * 86400_000).toISOString();
  const [{ data: mine }, { data: refused }] = await Promise.all([
    sb.from("orders").select("id, cart_id, status, pay_on_delivery").eq("buyer_id", buyer_id).eq("pay_on_delivery", true)
      .order("created_at", { ascending: false }).limit(20),
    sb.from("orders").select("updated_at").eq("buyer_id", buyer_id).eq("pay_on_delivery", true)
      .eq("cancel_reason", POD_REFUSED_REASON).gte("updated_at", since).order("updated_at", { ascending: false }).limit(1),
  ]);
  const thisCheckout = (r: any) => r.id === order.id || (!!(order as any).cart_id && r.cart_id === (order as any).cart_id);
  const open = (mine || []).find((r: any) => isOpenPodOrder(r) && !thisCheckout(r));
  const already = rows.length > 0 && rows.every((r: any) => r.pay_on_delivery);

  const block: PodBlock | null = podBlockReason({
    payable: rows.length > 0 && !already,
    sellerAccepts: !!(listing as any)?.seller?.accepts_pay_on_delivery,
    total,
    openOrderId: open?.id ?? null,
    lastRefusedAt: (refused as any)?.[0]?.updated_at ?? null,
  });
  return { sb, order, rows, total, block, already };
}

export const GET: APIRoute = async ({ request, url }) => {
  const c = await check(request, url.searchParams.get("order_id"), url.searchParams.get("buyer_id"));
  if ("response" in c) return c.response;
  return new Response(JSON.stringify({ eligible: !c.block, chosen: c.already, amount: c.total, block: c.block }), { status: 200 });
};

export const POST: APIRoute = async ({ request, url }) => {
  let body: { order_id?: string; buyer_id?: string };
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400 }); }
  const c = await check(request, body.order_id ?? null, body.buyer_id ?? null);
  if ("response" in c) return c.response;
  if (c.already) return new Response(JSON.stringify({ ok: true, already: true }), { status: 200 });
  if (c.block) return new Response(JSON.stringify({ error: c.block.message, block: c.block }), { status: c.block.code === "open_order" ? 409 : 400 });

  // Guarded on "still unpaid and still awaiting payment": a payment landing at the same moment wins.
  const ids = c.rows.map((r: any) => r.id);
  const { data: moved, error } = await c.sb.from("orders").update({ pay_on_delivery: true })
    .in("id", ids).in("status", ["pending", "pending_payment"]).is("razorpay_payment_id", null).select("id");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!moved?.length) return new Response(JSON.stringify({ error: "This order was just updated. Refresh and try again." }), { status: 409 });

  const { notifyOrderParties } = await import("../../../lib/server/notify-order-parties");
  await notifyOrderParties({ order_id: moved[0].id, event: "pay_on_delivery", origin: url.origin, order_ids: moved.map((r: any) => r.id), amount: c.total })
    .catch((err: any) => console.warn("[pay-on-delivery] notify failed", { order_id: body.order_id, err: err?.message }));
  return new Response(JSON.stringify({ ok: true, amount: c.total }), { status: 200 });
};
