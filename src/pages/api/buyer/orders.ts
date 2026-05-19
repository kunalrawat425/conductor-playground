import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

/**
 * GET /api/buyer/orders?buyer_id=<id>&phone=<phone>&page=1&page_size=10
 * Returns paginated past orders for a buyer (completed, declined, cancelled, refunded, picked_up).
 */
export const GET: APIRoute = async ({ url }) => {
  const buyer_id = url.searchParams.get("buyer_id");
  const phone = url.searchParams.get("phone") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const page_size = Math.min(20, Math.max(1, parseInt(url.searchParams.get("page_size") || "10")));

  if (!buyer_id) {
    return new Response(JSON.stringify({ error: "buyer_id required" }), { status: 400 });
  }

  try {
    const sb = createClient(
      import.meta.env.PUBLIC_SUPABASE_URL || "",
      import.meta.env.SUPABASE_SERVICE_KEY || ""
    );

    const pastStatuses = ["picked_up", "completed", "declined", "cancelled", "refunded"];
    const offset = (page - 1) * page_size;

    const phoneNorm = phone ? `+91${phone.replace(/^\+91/, "").replace(/\D/g, "")}` : "";
    const orClause = phoneNorm && phoneNorm !== "+91"
      ? `buyer_id.eq.${buyer_id},buyer_phone.eq.${phone},buyer_phone.eq.${phoneNorm}`
      : `buyer_id.eq.${buyer_id}`;

    const { data: orders, count, error } = await sb
      .from("orders")
      .select(
        "id, status, created_at, total_price, quantity, quantity_unit, cut_style, buyer_notes, placement_kind," +
        "listing:fish_listings(species, seller:sellers(name))",
        { count: "exact" }
      )
      .or(orClause)
      .in("status", pastStatuses)
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
