import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { deliveryDaysAt, slotDayLabel, slotTimeLabel, SLOT_SELLER_COLUMNS } from "../../../lib/delivery-slots";

const istDate = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);
/** "Today", "Tomorrow", "Sat 25 Oct". */
const dayLabel = (date: string) =>
  date === istDate(Date.now()) ? "Today" : date === istDate(Date.now() + 86_400_000) ? "Tomorrow" : slotDayLabel(`${date}T12:00:00+05:30`);

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * GET /api/seller/fulfillment?seller_id=uuid
 * Public fulfillment flags for buyer checkout (no PII), plus the delivery days and slots the
 * buyer can pick right now (null = the seller has slots off; [] = none left). A day's `kind`
 * is the order it makes: same_day (Today) or preorder.
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const seller_id = url.searchParams.get("seller_id");
    if (!seller_id) {
      return new Response(JSON.stringify({ error: "seller_id required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase
      .from("sellers")
      .select(`has_pickup, has_delivery, ${SLOT_SELLER_COLUMNS}`)
      .eq("id", seller_id)
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    if (!data) {
      return new Response(JSON.stringify({ error: "Seller not found" }), { status: 404 });
    }

    return new Response(
      JSON.stringify({
        has_pickup: data.has_pickup !== false,
        has_delivery: !!data.has_delivery,
        delivery_days: data.delivery_slots_enabled
          ? deliveryDaysAt(data).map((d) => ({
              date: d.date,
              kind: d.kind,
              label: dayLabel(d.date),
              slots: d.slots.map((s) => ({ ...s, time: slotTimeLabel(s.start, s.end) })),
            }))
          : null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("seller/fulfillment:", err);
    return new Response(JSON.stringify({ error: err?.message || "Error" }), { status: 500 });
  }
};
