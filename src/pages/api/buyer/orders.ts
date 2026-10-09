import type { APIRoute } from "astro";
import { requireBuyer } from "../../../lib/server/session";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

/**
 * GET /api/buyer/orders?buyer_id=<id>&page=1&page_size=10&scope=all|active|past
 * Returns paginated orders for a buyer. `scope` defaults to `all` — returns
 * every status so /me can group into Active + Past sections. Prior behaviour
 * (past-only) available via `scope=past` for callers that still want it.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// BUG-47: pre_order, scheduled, paid and payment_required are all in-flight,
// but were in neither ACTIVE nor PAST, so /me filed them under "Past" with a
// "View →" CTA. A payment_required order is one where the buyer still OWES a
// balance, and a pre_order is waiting on the seller's final price — filing
// either as finished is the same "my order vanished" complaint that BUG-2 was
// about, just for the statuses BUG-2 missed.
const ACTIVE_STATUSES = [
  "pending", "pending_payment", "payment_required",
  "pre_order", "scheduled", "confirmed", "paid",
  "ready_for_pickup", "out_for_delivery",
] as const;
const PAST_STATUSES = ["picked_up", "completed", "declined", "cancelled", "refunded"] as const;

export const GET: APIRoute = async ({ url, request }) => {
  const buyer_id = url.searchParams.get("buyer_id");
  { const denied = requireBuyer(request, buyer_id); if (denied) return denied; }
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const page_size = Math.min(50, Math.max(1, parseInt(url.searchParams.get("page_size") || "20")));
  const scope = (url.searchParams.get("scope") || "all").toLowerCase();

  if (!buyer_id || !UUID_RE.test(buyer_id)) {
    return new Response(JSON.stringify({ error: "valid buyer_id required" }), { status: 400 });
  }

  try {
    // Service key: the open "read every order" RLS policy is gone (076). Access
    // is the buyer's signed session above + their own phone on record below.
    const offset = (page - 1) * page_size;

    // Phone-matched orders (placed before login linked buyer_id) come from the
    // buyer's OWN phone on record, never the query string. The raw `phone`
    // param was interpolated into the PostgREST .or() filter: any phone's
    // orders, or `phone=x,id.not.is.null` for every order in the table.
    const admin = createClient(
      import.meta.env.PUBLIC_SUPABASE_URL || "",
      import.meta.env.SUPABASE_SERVICE_KEY || ""
    );
    const sb = admin;
    const { data: me } = await admin.from("buyers").select("phone").eq("id", buyer_id).maybeSingle();
    const own = String(me?.phone || "").replace(/\D/g, "").slice(-10);
    const phoneClauses = /^[6-9]\d{9}$/.test(own)
      ? `,buyer_phone.eq.${own},buyer_phone.eq.+91${own}`
      : "";
    const orClause = `buyer_id.eq.${buyer_id}${phoneClauses}`;

    let query = sb
      .from("orders")
      .select(
        // The buyer's own orders, with what /track and /me render (seller hours for the stepper).
        "*, listing:fish_listings(species, pricing_options, is_preorder_enabled, seller:sellers(name, opens_at, closes_at, open_days, preorder_days, preorder_cutoff_time, accepts_preorder))",
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
