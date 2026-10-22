import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { sendBuyerOrderPush } from "../../../lib/server/buyer-push";
import { sendTransactionalEmail } from "../../../lib/server/send-email";
import { isRazorpayPaid, refundRazorpayPayment } from "../../../lib/server/razorpay-refund";
import { preorderNeedsFinalPrice } from "../../../lib/order-payment-state";
import { refundOrderRazorpay } from "../../../lib/server/razorpay-ledger";
import { orderEmailBuyer, orderEmailSeller } from "../../../lib/email-templates";
import { toSellerView, STATUS_BY_TAB } from "../../../lib/seller-order-view";
import { cartLabel, isLiveRow, rowPaise, moveFeeOffClosedRow } from "../../../lib/server/order-cart";
import { cancelReasonText, checkCancelReason } from "../../../lib/order-cancel";
import { orderSlotText, sellerSlotError } from "../../../lib/delivery-slots";

function capitalizeFishName(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

const STATUS_LABELS: Record<string, string> = {
  pending: "Order Placed",
  pending_payment: "Payment Pending",
  confirmed: "Order Confirmed",
  paid: "Payment Received",
  payment_required: "Additional Payment Required",
  ready_for_pickup: "Ready for Pickup",
  out_for_delivery: "Out for Delivery",
  picked_up: "Order Picked Up",
  completed: "Order Completed",
  declined: "Order Declined",
  cancelled: "Order Cancelled",
  refunded: "Refund Processed",
  scheduled: "Order Scheduled",
  pre_order: "Pre-order Placed",
};

/**
 * POST /api/seller/orders
 * Body: { seller_id, order_id, status?, action?, final_price?, cancel_reason?, cart?, delivery_slot? }
 * cart=true: the status change applies to every live row of order_id's cart.
 * delivery_slot={start,end}: with confirmed / out_for_delivery, the seller's new delivery
 * slot or "arriving by" window for the moved rows (the buyer hears it in the same notification).
 * action=set_final_price: calls reconcile_preorder_price RPC (refunds a price drop on Razorpay)
 * Otherwise: status transition
 */
/**
 * GET /api/seller/orders?seller_id&tab&type&since&today_start&page&q
 * The dashboard used to read `orders` straight from the browser with the
 * public key — and so could anyone else. Now it reads here, behind the seller
 * session, and gets buyer contact masked (toSellerView).
 */
const PAGE_SIZE = 10;
export const GET: APIRoute = async ({ url, request }) => {
  const p = url.searchParams;
  const seller_id = p.get("seller_id");
  const { assertSellerOwns } = await import("../../../lib/server/assert-seller");
  const authCheck = await assertSellerOwns(seller_id, null, request);
  if (authCheck instanceof Response) return authCheck;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: listings } = await supabase.from("fish_listings").select("id").eq("seller_id", seller_id!);
  const ids = (listings || []).map((l: any) => l.id);
  if (!ids.length) return new Response(JSON.stringify({ has_listings: false, orders: [], total: 0, counts: {}, today_gmv: 0 }), { status: 200 });

  // Tab badges count ORDERS the seller sees (one per cart), not item rows.
  // ponytail: reads every row's status for this seller; fine at today's volume, move to an RPC past ~10k rows.
  const todayStart = p.get("today_start") || new Date(Date.now() - 86400_000).toISOString();
  const [{ data: allRows }, today] = await Promise.all([
    supabase.from("orders").select("id, cart_id, status, is_preorder").in("listing_id", ids),
    supabase.from("orders").select("total_price").in("listing_id", ids).gte("created_at", todayStart),
  ]);
  const count = (keep: (r: any) => boolean) => new Set((allRows || []).filter(keep).map((r: any) => r.cart_id || r.id)).size;
  const closed = ["completed", "picked_up", "declined", "cancelled", "refunded"];
  const counts = {
    pending: count((r) => STATUS_BY_TAB.pending.includes(r.status)),
    accepted: count((r) => STATUS_BY_TAB.accepted.includes(r.status)),
    completed: count((r) => ["picked_up", "completed"].includes(r.status)),
    declined: count((r) => ["declined", "cancelled", "refunded"].includes(r.status)),
    preorders: count((r) => r.is_preorder === true && !closed.includes(r.status)),
  };
  const today_gmv = (today.data || []).reduce((s: number, o: any) => s + (Number(o.total_price) || 0), 0);

  const SELECT = "*, listing:fish_listings(species, pricing_options), order_feedback(rating, feedback, updated_at)";
  const page = Math.max(1, Number(p.get("page")) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const type = p.get("type") || "all";
  const isPre = (o: any) => o.is_preorder === true || o.placement_kind === "preorder" || o.status === "pre_order";
  const q = (p.get("q") || "").trim().toLowerCase();

  let orders: any[] = [];
  let total = 0;
  if (q) {
    // Search by order id or the last digits of the buyer phone (all a seller ever sees).
    const { data } = await supabase.from("orders").select(SELECT).in("listing_id", ids)
      .order("created_at", { ascending: false }).limit(500);
    const matched = (data || []).map(toSellerView).filter((o: any) =>
      o.id.toLowerCase().includes(q) || (q.length <= 4 && (o.buyer_phone || "").includes(q)))
      .filter((o: any) => type === "order" ? !isPre(o) : type === "preorder" ? isPre(o) : true);
    total = matched.length;
    orders = matched.slice(offset, offset + PAGE_SIZE);
  } else {
    // Whole tab, then one card per cart, then the page: a page is 10 orders, not 10 item rows.
    let query = supabase.from("orders").select(SELECT).in("listing_id", ids)
      .in("status", STATUS_BY_TAB[p.get("tab") || "pending"] || STATUS_BY_TAB.pending)
      .order("created_at", { ascending: false }).limit(1000);
    const since = p.get("since");
    if (since) query = query.gte("created_at", since);
    if (type === "order") query = query.not("is_preorder", "is", true);
    if (type === "preorder") query = query.eq("is_preorder", true);
    const { data } = await query;
    const seenCart = new Set<string>();
    const cards = (data || []).map(toSellerView).filter((o: any) => {
      if (!o.cart_id) return true;
      if (seenCart.has(o.cart_id)) return false;
      seenCart.add(o.cart_id);
      return true;
    });
    // Active tabs: orders with a delivery slot first, earliest first (stable sort keeps the rest newest-first).
    if ((p.get("tab") || "pending") !== "completed") {
      const at = (o: any) => (o.delivery_slot_start ? Date.parse(o.delivery_slot_start) : Infinity);
      cards.sort((a: any, b: any) => (at(a) === at(b) ? 0 : at(a) - at(b)));
    }
    total = cards.length;
    orders = cards.slice(offset, offset + PAGE_SIZE);
  }
  // One card per cart: the first row of a cart on this page carries every row
  // of that cart (any status) as cart_items, in checkout order. A cart still in
  // progress stays off History even when one of its items was cancelled.
  const cartIds = [...new Set(orders.map((o) => o.cart_id).filter(Boolean))];
  if (cartIds.length) {
    const { data: cartRows } = await supabase.from("orders").select(SELECT).in("cart_id", cartIds).in("listing_id", ids)
      .order("created_at", { ascending: true });
    const byCart = new Map<string, any[]>();
    for (const r of (cartRows || []).map(toSellerView) as any[]) byCart.set(r.cart_id, [...(byCart.get(r.cart_id) || []), r]);
    const tab = q ? null : p.get("tab") || "pending";
    const seen = new Set<string>();
    orders = orders.flatMap((o) => {
      const rows = (o.cart_id && byCart.get(o.cart_id)) || [o];
      if (rows.length < 2) return [o];
      if (seen.has(o.cart_id)) return [];
      seen.add(o.cart_id);
      if (tab === "completed" && rows.some((r) => !STATUS_BY_TAB.completed.includes(r.status))) return [];
      return [{ ...rows[0], cart_items: rows }];
    });
  }
  return new Response(JSON.stringify({ has_listings: true, counts, today_gmv, orders, total, page_size: PAGE_SIZE }), { status: 200 });
};

/**
 * Move one order row to `status` with today's checks: allowed transition,
 * paid before confirm, pickup vs delivery step, pre-order price set, refund on
 * a seller cancel, and an update guarded on the status it was validated in.
 * No notifications — the caller sends one for the row or the whole cart.
 */
async function transitionRow(
  supabase: any, order_id: string, status: string, seller_id: string, why: string
): Promise<{ error: string; code: number } | { data: any; currentOrder: any }> {
  const validTransitions: Record<string, string[]> = {
    // Not paid yet: the seller can only decline (or confirm a row whose
    // payment is already captured — guarded below).
    pending: ["confirmed", "declined"],
    pending_payment: ["confirmed", "declined"],
    pre_order: ["confirmed", "declined"],
    scheduled: ["confirmed", "declined"],
    // Paid, awaiting the seller: accept → confirmed, or decline → full refund.
    paid: ["confirmed", "declined", "cancelled"],
    // Accepted: fulfil, or cancel with a full refund (policy: seller cancellations).
    confirmed: ["ready_for_pickup", "out_for_delivery", "declined", "cancelled"],
    payment_required: ["confirmed", "cancelled"],
    ready_for_pickup: ["completed", "cancelled"],
    out_for_delivery: ["completed", "cancelled"],
    // `refunded`, `completed`, `declined`, `cancelled` are terminal: no exits.
  };
  const { data: currentOrder } = await supabase
    .from("orders")
    .select("status, order_type, paid_amount, final_price, payment_screenshot_urls, total_price, delivery_fee, payment_method, payment_verified_at, razorpay_payment_id, razorpay_order_id, is_preorder, placement_kind, pricing_option_id, quantity, quantity_unit, listing:fish_listings(pricing_options)")
    .eq("id", order_id)
    .single();
  const currentStatus = currentOrder?.status;

  // Razorpay is the only payment method: an order is confirmed only once its
  // payment is captured (settle confirms it automatically; this covers the
  // seller's "Confirm order" for a paid row whose confirm write was lost).
  if (status === "confirmed" && !(currentOrder as any)?.razorpay_payment_id) {
    return { error: "Confirm only after the buyer has paid. Use “Check Razorpay for payment”.", code: 400 };
  }
  // A status missing from the map used to skip this check entirely, so
  // `cancelled → confirmed` or `completed → declined` were accepted.
  // Fulfilment step must match how the order is fulfilled: a pickup order was
  // accepted into out_for_delivery (found on staging), and vice versa.
  const orderType = (currentOrder as any)?.order_type;
  if ((status === "out_for_delivery" && orderType !== "delivery") || (status === "ready_for_pickup" && orderType !== "pickup")) {
    return { error: `This is a ${orderType || "pickup"} order — use ${orderType === "delivery" ? "Out for delivery" : "Ready for pickup"}`, code: 400 };
  }
  if (!currentStatus || !validTransitions[currentStatus]?.includes(status)) {
    return { error: `Cannot change from ${currentStatus} to ${status}`, code: 400 };
  }
  // Pre-orders priced on a range must have their catch price set before
  // fulfilment (same rule as the dashboard's "Set price" button).
  const tryingToFulfill = status === "ready_for_pickup" || status === "out_for_delivery";
  if (tryingToFulfill && preorderNeedsFinalPrice(currentOrder as any)) {
    return { error: "Set final price first before moving preorder to pickup/delivery", code: 400 };
  }

  // final_price is only ever set through action=set_final_price (validated, and
  // reconciled by the RPC). Writing it here unvalidated skipped refund_amt.
  const updates: any = { status };
  if (status === "declined" || status === "cancelled") {
    updates.cancelled_by = "seller";
    // The seller's reason is shown to the buyer (screen + notification). It used
    // to be written into refund_note, mixed with refund gateway text.
    updates.cancel_reason = why || null;

    // BUG-44: refunds go through the same helper as the buyer cancel (the funds
    // sit in the platform's Razorpay account, not the seller's). They run AFTER
    // the guarded status claim below: refunding first let a double tap (or a
    // buyer cancel at the same moment) refund twice — harmless when every refund
    // was "everything left", not when an item gets a partial share of a cart payment.
  }
  // Stamp payment_verified_at if a paid row reached here without it.
  if (status === "confirmed" && !(currentOrder as any)?.payment_verified_at) {
    updates.payment_verified_at = new Date().toISOString();
    updates.payment_verified_by = seller_id;
  }

  // Guard on the status we validated against: a concurrent buyer cancel or a
  // second click must not be overwritten (e.g. a refunded order flipped to Ready).
  const { data: rows, error } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", order_id)
    .eq("status", currentStatus)
    .select();

  if (error) return { error: error.message, code: 500 };
  let data = rows?.[0];
  if (!data) return { error: "This order was just updated. Refresh and try again.", code: 409 };

  if (status === "declined" || status === "cancelled") {
    if (isRazorpayPaid(currentOrder as any)) {
      // Every payment on the order: upfront (its share, on a cart) plus any balance top-up.
      const outcome = await refundOrderRazorpay(
        supabase,
        { id: order_id, razorpay_payment_id: (currentOrder as any).razorpay_payment_id, razorpay_order_id: (currentOrder as any).razorpay_order_id },
        { caller: `seller/orders:${status}` }
      );
      const refundFields: Record<string, unknown> = { refund_note: outcome.note };
      if (outcome.ok) {
        // A cart item gets back its own share (the delivery fee only with the last item).
        refundFields.refund_amt = outcome.refundedRupees ?? (Number((currentOrder as any).paid_amount)
          || (Number((currentOrder as any).total_price) + Number((currentOrder as any).delivery_fee || 0)));
        refundFields.refund_sent_at = new Date().toISOString();
      }
      const upd = await supabase.from("orders").update(refundFields).eq("id", order_id).select();
      if (upd.error) console.error("[seller/orders] refund recorded on Razorpay but not on the order", { order_id, err: upd.error.message });
      else if (upd.data?.[0]) data = upd.data[0];
    } else {
      // Unpaid: the delivery fee must not leave the cart with this item.
      await moveFeeOffClosedRow(supabase, order_id);
    }
  }
  return { data, currentOrder };
}

/** One row as an email line: quantity in packs when the tier is a bundle. */
function emailItem({ data, currentOrder }: { data: any; currentOrder: any }) {
  const qty = Number(data.quantity) || 0;
  const pricingOptionId = currentOrder?.pricing_option_id;
  const pricingOptions = currentOrder?.listing?.pricing_options;
  let bundleSize: number | null = null;
  let bundleCount: number | null = null;
  if (Array.isArray(pricingOptions) && pricingOptions.length > 0) {
    const opt = pricingOptionId
      ? pricingOptions.find((o: any, i: number) => o.id === pricingOptionId || `opt_${i}` === pricingOptionId)
      : pricingOptions[0];
    if (opt?.bundle_size && Number(opt.bundle_size) > 1) {
      bundleSize = Number(opt.bundle_size);
      bundleCount = Math.round(qty / bundleSize);
    }
  }
  return {
    species: String(data.species || "Fish"),
    quantity: qty,
    quantity_unit: data.quantity_unit || "piece",
    total_price: Number(data.total_price) || 0,
    bundleSize,
    bundleCount,
  };
}

/**
 * The seller removed one item and the rest of the cart goes ahead: one push +
 * one email to the buyer naming the item, the reason and the refund.
 */
async function notifyItemRemoved(sb: any, order: any, removed: any, cartRows: any[]) {
  const fish = capitalizeFishName(String(removed.species || "Fish"));
  const short = String(cartRows[0].id).slice(0, 8).toUpperCase();
  // Other items are still delivered, so only the item's price comes back (fee stays).
  const amount = isRazorpayPaid(removed) ? Number(removed.refund_amt) || Number(removed.total_price) || null : null;
  const refunded = amount ? ` — ₹${amount.toLocaleString("en-IN")} refunded` : "";
  const reason = cancelReasonText(removed.cancel_reason);
  if (order.buyer_id || order.buyer_phone) {
    try {
      await sendBuyerOrderPush({
        buyer_id: order.buyer_id,
        buyer_phone: order.buyer_phone,
        status: removed.status,
        species: fish,
        order_id: cartRows[0].id,
        cancel: { by: "seller", reason, refunded: !!amount, item: { order_short: short, amount } },
      });
    } catch (err) { console.warn("[seller/orders] item-removed push failed", { order_id: removed.id, err: (err as any)?.message }); }
  }
  if (!order.buyer_id) return;
  try {
    const { data: buyer } = await sb.from("buyers").select("email").eq("id", order.buyer_id).single();
    if (!buyer?.email) return;
    const live = cartRows.filter((r) => isLiveRow(r.status));
    await sendTransactionalEmail(buyer.email, `${fish} was removed from your order #${short}${refunded}`, orderEmailBuyer({
      statusLabel: "Item Removed",
      species: fish,
      quantity: Number(removed.quantity) || 0,
      quantity_unit: removed.quantity_unit || "kg",
      totalAmount: live.reduce((s, r) => s + rowPaise(r), 0) / 100,
      deliveryFee: live.reduce((s, r) => s + (Number(r.delivery_fee) || 0), 0),
      orderId: cartRows[0].id,
      items: cartRows.map((r) => ({
        species: String(r.species || "Fish"),
        quantity: Number(r.quantity) || 0,
        quantity_unit: r.quantity_unit || "kg",
        total_price: Number(r.total_price) || 0,
        note: r.id === removed.id
          ? [`Removed by the seller${refunded}`, reason && `Reason: ${reason}`].filter(Boolean).join(" · ")
          : isLiveRow(r.status) ? null : "Cancelled",
      })),
    }));
  } catch (err) { console.warn("[seller/orders] item-removed email failed", { order_id: removed.id, err: (err as any)?.message }); }
}

export const POST: APIRoute = async ({ request, url }) => {
  try {
    const { seller_id, seller_phone, order_id, status, action, final_price, refund_note, cancel_reason, cart, delivery_slot } = await request.json();

    if (!seller_id || !order_id) {
      return new Response(JSON.stringify({ error: "seller_id and order_id required" }), { status: 400 });
    }
    if (!action && !status) {
      return new Response(JSON.stringify({ error: "action or status required" }), { status: 400 });
    }

    // BUG-12: verify seller_phone matches the seller row.
    // seller_id is publicly exposed via /api/search so cannot be a bearer alone.
    const { assertSellerOwns } = await import("../../../lib/server/assert-seller");
    const authCheck = await assertSellerOwns(seller_id, seller_phone, request);
    if (authCheck instanceof Response) return authCheck;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify order belongs to this seller's listings
    const { data: order, error: orderFetchErr } = await supabase
      .from("orders")
      .select("listing_id, cart_id, buyer_id, buyer_phone, species, status, paid_amount, final_price, refund_amt, payment_screenshot_urls, payment_method, payment_verified_at, razorpay_payment_id")
      .eq("id", order_id)
      .single();

    if (orderFetchErr || !order) {
      return new Response(
        JSON.stringify({ error: orderFetchErr?.message || "Order not found" }),
        { status: orderFetchErr ? 500 : 404 }
      );
    }

    if (order.listing_id) {
      const { data: listing } = await supabase
        .from("fish_listings")
        .select("seller_id")
        .eq("id", order.listing_id)
        .single();

      if (!listing || listing.seller_id !== seller_id) {
        return new Response(JSON.stringify({ error: "Not your order" }), { status: 403 });
      }
    } else {
      // No listing anchor — deny (can't verify ownership without listing)
      return new Response(JSON.stringify({ error: "Order ownership cannot be verified" }), { status: 403 });
    }

    // action=set_final_price: use reconcile_preorder_price RPC
    if (action === "set_final_price") {
      if (final_price === undefined || final_price === null) {
        return new Response(JSON.stringify({ error: "final_price required for set_final_price" }), { status: 400 });
      }
      const parsedFinal = Number(final_price);
      if (!Number.isFinite(parsedFinal) || parsedFinal <= 0) {
        return new Response(JSON.stringify({ error: "final_price must be a positive number" }), { status: 400 });
      }
      if (order.paid_amount === null || order.paid_amount === undefined || !order.razorpay_payment_id) {
        return new Response(JSON.stringify({ error: "Set the final price once the buyer's payment is in" }), { status: 400 });
      }
      if (order.final_price !== null && order.final_price !== undefined) {
        return new Response(JSON.stringify({ error: "Final price already set for this order" }), { status: 400 });
      }
      if (!["confirmed", "paid"].includes(String(order.status || ""))) {
        return new Response(JSON.stringify({ error: "Set final price once the order is confirmed" }), { status: 400 });
      }
      const { data: newStatus, error: rpcErr } = await supabase.rpc("reconcile_preorder_price", {
        p_order_id: order_id,
        p_final_price: parsedFinal,
      });
      if (rpcErr) {
        return new Response(JSON.stringify({ error: rpcErr.message }), { status: 500 });
      }
      let { data, error: fetchErr } = await supabase.from("orders").select().eq("id", order_id).single();
      if (fetchErr) {
        return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
      }
      // Catch priced in lower than the pre-order max the buyer paid: refund the
      // difference on Razorpay right away. It used to sit in refund_amt and the
      // seller was told to send it over UPI — but the money is in the platform's
      // Razorpay account, not the seller's.
      const dueBack = Number((data as any)?.refund_amt) || 0;
      if (newStatus === "confirmed" && dueBack > 0 && isRazorpayPaid(data as any) && !(data as any).refund_sent_at) {
        const outcome = await refundRazorpayPayment(
          String((data as any).razorpay_payment_id),
          { order_id, caller: "seller/orders:set_final_price" },
          Math.round(dueBack * 100)
        );
        const patch: Record<string, unknown> = { refund_note: `Price set at ₹${parsedFinal}: ${outcome.note}` };
        if (outcome.ok) patch.refund_sent_at = new Date().toISOString();
        const upd = await supabase.from("orders").update(patch).eq("id", order_id).select().single();
        if (upd.error) console.error("[seller/orders] partial refund recorded on Razorpay but not on the order", { order_id, refund: outcome.refundId, err: upd.error.message });
        else data = upd.data;
      }
      if (order.buyer_id || order.buyer_phone) {
        try {
          await sendBuyerOrderPush({
            buyer_id: order.buyer_id,
            buyer_phone: order.buyer_phone,
            status: newStatus,
            species: order.species || "Fish",
            final_price,
            order_id,
          });
        } catch (err) { console.warn("[seller/orders] set_final_price buyer push failed", { order_id, err: (err as any)?.message }); }
      }
      return new Response(JSON.stringify({ order: toSellerView(data), reconciled_status: newStatus }), { status: 200 });
    }

    // Razorpay is the only payment method: no manual UPI verification and no
    // "mark refund sent" — refunds go back through Razorpay automatically.
    if (action) {
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }

    // Default: status transition. `cart: true` moves every live row of this
    // order's cart (one checkout) that the seller owns, each through the same
    // per-row checks; a row that can't move is skipped. Without it, just this row.
    let rowIds: string[] = [order_id];
    if (cart && order.cart_id) {
      const { data: mine } = await supabase.from("fish_listings").select("id").eq("seller_id", seller_id);
      const { data: cartRows } = await supabase.from("orders").select("id, status")
        .eq("cart_id", order.cart_id).in("listing_id", (mine || []).map((l: any) => l.id))
        .order("created_at", { ascending: true });
      const live = (cartRows || []).filter((r: any) => isLiveRow(r.status)).map((r: any) => r.id);
      if (live.length) rowIds = live;
    }
    const newSlot = delivery_slot && (status === "confirmed" || status === "out_for_delivery") ? delivery_slot : null;
    const slotErr = newSlot ? sellerSlotError(newSlot) : null;
    if (slotErr) return new Response(JSON.stringify({ error: slotErr }), { status: 400 });
    const why = String(cancel_reason ?? refund_note ?? "").trim().slice(0, 200);
    // The buyer reads the seller's reason, so a cancel or decline needs one.
    if (status === "declined" || status === "cancelled") {
      const typed = checkCancelReason(why);
      if (!typed.ok) return new Response(JSON.stringify({ error: typed.error }), { status: 400 });
    }
    const moved: { data: any; currentOrder: any }[] = [];
    let firstErr: { error: string; code: number } | null = null;
    for (const id of rowIds) {
      const r = await transitionRow(supabase, id, status, seller_id, why);
      if ("error" in r) firstErr ??= r;
      else moved.push(r);
    }
    if (!moved.length) return new Response(JSON.stringify({ error: firstErr!.error }), { status: firstErr!.code });
    // The seller kept or changed the delivery slot / "arriving by" time.
    let slotChanged = false;
    if (newSlot && moved[0].data.order_type === "delivery") {
      const next = { delivery_slot_start: new Date(newSlot.start).toISOString(), delivery_slot_end: new Date(newSlot.end).toISOString() };
      const cur = moved[0].data;
      slotChanged = Date.parse(cur.delivery_slot_start) !== Date.parse(next.delivery_slot_start)
        || Date.parse(cur.delivery_slot_end) !== Date.parse(next.delivery_slot_end);
      if (slotChanged) {
        const { error: slotWriteErr } = await supabase.from("orders").update(next).in("id", moved.map((m) => m.data.id));
        if (slotWriteErr) { console.error("[seller/orders] delivery slot not saved", { order_id, err: slotWriteErr.message }); slotChanged = false; }
        else for (const m of moved) Object.assign(m.data, next);
      }
    }
    const data = moved[0].data;
    const ok = () => new Response(JSON.stringify({ order: toSellerView(data), orders: moved.map((m) => toSellerView(m.data)) }), { status: 200 });

    // Seller cancelled / declined: one notifier tells the buyer who cancelled,
    // the reason and the refund, on push and email.
    if (status === "declined" || status === "cancelled") {
      // One item of a bigger cart while the rest goes ahead: tell the buyer what
      // was removed and refunded, not that their order was cancelled.
      if (!cart && data.cart_id) {
        const { data: cartRows } = await supabase.from("orders")
          .select("id, status, species, quantity, quantity_unit, total_price, delivery_fee, created_at")
          .eq("cart_id", data.cart_id).order("created_at", { ascending: true });
        if ((cartRows || []).some((r: any) => r.id !== data.id && isLiveRow(r.status))) {
          await notifyItemRemoved(supabase, order, data, cartRows!);
          return ok();
        }
      }
      const { notifyOrderParties } = await import("../../../lib/server/notify-order-parties");
      await notifyOrderParties({ order_id: data.id, event: "cancelled_by_seller", origin: url.origin, order_ids: moved.map((m) => m.data.id) })
        .catch((err: any) => console.warn("[seller/orders] cancel notify failed", { order_id, err: err?.message }));
      return ok();
    }

    // One push and one email per party for the whole batch (a cart lists its items).
    const many = moved.length > 1;
    const species = many ? cartLabel(moved.map((m) => m.data.species)) : order.species || "Fish";
    // Slot / arriving-by time: told on confirm and out for delivery (not on delivered).
    const slotText = status === "confirmed" || status === "out_for_delivery" ? orderSlotText(data) : null;
    const { data: seller } = await supabase.from("sellers").select("email").eq("id", seller_id).single();

    // Notify buyer via push — never fail the order update if push throws
    if (order.buyer_id || order.buyer_phone) {
      try {
        const pushResult = await sendBuyerOrderPush({
          buyer_id: order.buyer_id,
          buyer_phone: order.buyer_phone,
          status,
          species,
          final_price: final_price ?? null,
          order_id: data.id,
          slot: slotText ? { when: slotText.value, changed: slotChanged } : null,
        });
        if (!pushResult.ok) {
          console.error("Buyer push failed:", pushResult.error);
        } else if (!pushResult.sent) {
          console.info("Buyer push skipped:", pushResult.reason);
        }
      } catch (pushErr: any) {
        console.error("Buyer push exception:", pushErr?.message || pushErr);
      }
    }

    // Send email notifications to buyer and seller
    try {
      const statusLabel = STATUS_LABELS[status] || status;
      const speciesLabel = many ? species : capitalizeFishName(species);
      const items = moved.map(emailItem);
      const fees = moved.reduce((s, m) => s + (Number(m.data.delivery_fee) || 0), 0);
      const totalAmount = many
        ? items.reduce((s, i) => s + i.total_price, 0)
        : final_price ? Number(final_price) : Number(data.total_price) || 0;
      const lead = moved[0].currentOrder as any;
      const isPreorder = lead?.is_preorder === true || lead?.placement_kind === "preorder";
      const emailArgs = {
        statusLabel,
        species: speciesLabel,
        quantity: items[0].quantity,
        quantity_unit: items[0].quantity_unit,
        totalAmount: totalAmount + fees,
        deliveryFee: fees,
        orderId: data.id,
        scheduled_for: data.scheduled_for || null,
        buyerNotes: data.buyer_notes || null,
        cutStyle: data.cut_style || null,
        isPreorder,
        deliverySlot: slotText?.value || null,
        deliverySlotLabel: slotText ? `${slotText.label}${slotChanged ? " (new time)" : ""}` : undefined,
        bundleSize: items[0].bundleSize,
        bundleCount: items[0].bundleCount,
        items: many ? items : undefined,
      };

      // Email buyer (if they have email)
      if (order.buyer_id) {
        const { data: buyer } = await supabase.from("buyers").select("email").eq("id", order.buyer_id).single();
        if (buyer?.email) {
          await sendTransactionalEmail(buyer.email, `${statusLabel} — ${speciesLabel}`, orderEmailBuyer(emailArgs));
        }
      }

      // Email seller
      if (seller?.email) {
        await sendTransactionalEmail(seller.email, `Order Update: ${statusLabel} — ${speciesLabel}`, orderEmailSeller(emailArgs));
      }

    } catch (err) { console.warn("[seller/orders] status-change email fan-out failed", { order_id, err: (err as any)?.message }); }

    return ok();
  } catch (err: any) {
    console.error("Seller orders error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
