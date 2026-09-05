import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

/**
 * GET /api/buyer/orders?buyer_id=<id>&phone=<phone>&page=1&page_size=10&scope=all|active|past
 * Returns paginated orders for a buyer. `scope` defaults to `all` — returns
 * every status so /me can group into Active + Past sections. Prior behaviour
 * (past-only) available via `scope=past` for callers that still want it.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIVE_STATUSES = ["pending", "pending_payment", "confirmed", "ready_for_pickup", "out_for_delivery"] as const;
const PAST_STATUSES = ["picked_up", "completed", "declined", "cancelled", "refunded"] as const;

export const GET: APIRoute = async ({ url }) => {
  const buyer_id = url.searchParams.get("buyer_id");
  const phone = (url.searchParams.get("phone") || "").trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const page_size = Math.min(50, Math.max(1, parseInt(url.searchParams.get("page_size") || "20")));
  const scope = (url.searchParams.get("scope") || "all").toLowerCase();

  if (!buyer_id || !UUID_RE.test(buyer_id)) {
    return new Response(JSON.stringify({ error: "valid buyer_id required" }), { status: 400 });
  }

  try {
    // Use anon key so Supabase RLS is enforced — service key bypasses RLS.
    // Orders table RLS allows read where buyer_id matches or buyer_phone matches.
    const sb = createClient(
      import.meta.env.PUBLIC_SUPABASE_URL || "",
      import.meta.env.PUBLIC_SUPABASE_ANON_KEY || ""
    );

    const offset = (page - 1) * page_size;

    // Only include phone clauses when phone is non-empty and normalises to something real
    const phoneNorm = phone ? `+91${phone.replace(/^\+91/, "").replace(/\D/g, "")}` : "";
    const phoneClauses = phoneNorm.length > 3
      ? `,buyer_phone.eq.${phone},buyer_phone.eq.${phoneNorm}`
      : "";
    const orClause = `buyer_id.eq.${buyer_id}${phoneClauses}`;

    let query = sb
      .from("orders")
      .select(
        "id, status, created_at, total_price, delivery_fee, quantity, quantity_unit, cut_style, buyer_notes, placement_kind, is_preorder, razorpay_order_id, razorpay_payment_id, payment_verified_at, payment_screenshot_urls, paid_amount, final_price," +
        "listing:fish_listings(species, seller:sellers(name))",
        { count: "exact" }
      )
      .or(orClause);

    if (scope === "active") query = query.in("status", ACTIVE_STATUSES as unknown as string[]);
    else if (scope === "past") query = query.in("status", PAST_STATUSES as unknown as string[]);
    // scope=all → no status filter

    const { data: orders, count, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + page_size - 1);

    if (error) throw error;

    return new Response(JSON.stringify({
      orders: orders || [],
      total: count || 0,
      page,
      page_size,
      total_pages: Math.ceil((count || 0) / page_size),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Failed" }), { status: 500 });
  }
};
