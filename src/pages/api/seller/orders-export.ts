import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { fmtDateLongIST } from "../../../lib/format-ist";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

export const GET: APIRoute = async ({ url }) => {
  try {
    const sellerId = url.searchParams.get("seller_id");
    const dateFilter = url.searchParams.get("date_filter") || "30d";

    if (!sellerId) {
      return new Response("seller_id required", { status: 400 });
    }

    const sb = createClient(supabaseUrl, supabaseServiceKey);

    const { data: listings } = await sb.from("fish_listings").select("id").eq("seller_id", sellerId);
    const listingIds = listings?.map((l: any) => l.id) || [];
    if (listingIds.length === 0) {
      return new Response("Order ID,Species,Quantity,Unit,Price,Status,Buyer Phone,Date\n", {
        status: 200,
        headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="orders-${dateFilter}.csv"` },
      });
    }

    let q = sb.from("orders").select("*").in("listing_id", listingIds).order("created_at", { ascending: false });

    const now = new Date();
    if (dateFilter === "7d") q = q.gte("created_at", new Date(now.getTime() - 7 * 86400000).toISOString());
    else if (dateFilter === "30d") q = q.gte("created_at", new Date(now.getTime() - 30 * 86400000).toISOString());
    else if (dateFilter === "today") q = q.gte("created_at", new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString());

    const { data: orders } = await q;

    const header = "Order ID,Species,Quantity,Unit,Price,Delivery Fee,Status,Type,Scheduled For,Date\n";
    const rows = (orders || []).map((o: any) => {
      const date = fmtDateLongIST(o.created_at);
      const sched = o.scheduled_for ? fmtDateLongIST(o.scheduled_for) : "";
      return `${o.id.substring(0, 8)},${o.species || ""},${o.quantity},${o.quantity_unit},${o.total_price},${o.delivery_fee || 0},${o.status},${o.order_type},${sched},${date}`;
    }).join("\n");

    return new Response(header + rows, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="relifish-orders-${dateFilter}.csv"`,
      },
    });
  } catch (err: any) {
    return new Response(err.message, { status: 500 });
  }
};
