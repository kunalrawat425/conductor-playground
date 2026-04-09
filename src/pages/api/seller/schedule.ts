import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action, seller_id } = body;

    if (!seller_id) {
      return new Response(JSON.stringify({ error: "seller_id required" }), { status: 400 });
    }

    const sb = createClient(supabaseUrl, supabaseServiceKey);

    if (action === "save_config") {
      let { date_from, date_to, start_time, end_time, slot_duration_minutes, days_ahead } = body;
      const todayStr = new Date().toISOString().split("T")[0];

      if (days_ahead != null && Number(days_ahead) > 0) {
        const n = Math.min(60, Math.max(1, parseInt(String(days_ahead), 10)));
        date_from = date_from || todayStr;
        const fromD = new Date(date_from + "T12:00:00");
        const toD = new Date(fromD);
        toD.setDate(toD.getDate() + n - 1);
        date_to = toD.toISOString().split("T")[0];
      }

      if (!date_from || !date_to || !start_time || !end_time) {
        return new Response(JSON.stringify({ error: "All schedule fields required" }), { status: 400 });
      }

      const duration = slot_duration_minutes || 60;
      const maxDays = 60;
      const from = new Date(date_from + "T12:00:00");
      const to = new Date(date_to + "T12:00:00");
      const diffDays = Math.ceil((to.getTime() - from.getTime()) / 86400000) + 1;
      if (diffDays > maxDays || diffDays < 1) {
        return new Response(JSON.stringify({ error: `Date range must be 1-${maxDays} days` }), { status: 400 });
      }

      // Upsert config
      await sb.from("seller_schedule_configs").upsert({
        seller_id, date_from, date_to, start_time, end_time, slot_duration_minutes: duration,
      }, { onConflict: "seller_id" });

      // Delete future slots and regenerate
      const today = new Date().toISOString().split("T")[0];
      await sb.from("seller_schedule_slots")
        .delete()
        .eq("seller_id", seller_id)
        .gte("slot_date", today);

      // Generate slots
      const slots: any[] = [];
      const [startH, startM] = start_time.split(":").map(Number);
      const [endH, endM] = end_time.split(":").map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        let cur = startMinutes;
        while (cur + duration <= endMinutes) {
          const slotStart = `${String(Math.floor(cur / 60)).padStart(2, "0")}:${String(cur % 60).padStart(2, "0")}`;
          const slotEndMin = cur + duration;
          const slotEnd = `${String(Math.floor(slotEndMin / 60)).padStart(2, "0")}:${String(slotEndMin % 60).padStart(2, "0")}`;
          slots.push({ seller_id, slot_date: dateStr, slot_start: slotStart, slot_end: slotEnd, is_enabled: true, date_disabled: false });
          cur += duration;
        }
      }

      if (slots.length > 0) {
        const { error } = await sb.from("seller_schedule_slots").insert(slots);
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      }

      return new Response(JSON.stringify({ success: true, slots_created: slots.length }), { status: 200 });
    }

    if (action === "toggle_slot") {
      const { slot_id, is_enabled } = body;
      if (!slot_id) return new Response(JSON.stringify({ error: "slot_id required" }), { status: 400 });
      await sb.from("seller_schedule_slots").update({ is_enabled }).eq("id", slot_id).eq("seller_id", seller_id);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    if (action === "toggle_date") {
      const { slot_date, date_disabled } = body;
      if (!slot_date) return new Response(JSON.stringify({ error: "slot_date required" }), { status: 400 });
      await sb.from("seller_schedule_slots")
        .update({ date_disabled, is_enabled: !date_disabled })
        .eq("seller_id", seller_id)
        .eq("slot_date", slot_date);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
