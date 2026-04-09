import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

type ScheduleConfigRow = {
  seller_id: string;
  date_from: string;
  date_to: string;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  days_ahead?: number | null;
  disabled_dates?: unknown;
  disabled_slots?: unknown;
};

function toIsoDate(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

function parseJsonArray<T>(v: unknown, fallback: T[] = []): T[] {
  if (Array.isArray(v)) return v as T[];
  return fallback;
}

function buildVirtualSlots(config: ScheduleConfigRow): Array<{
  id: string;
  seller_id: string;
  slot_date: string;
  slot_start: string;
  slot_end: string;
  is_enabled: boolean;
  date_disabled: boolean;
}> {
  const duration = Number(config.slot_duration_minutes) || 60;
  const daysAhead =
    config.days_ahead != null && Number(config.days_ahead) > 0
      ? Math.min(60, Math.max(1, Number(config.days_ahead)))
      : 7;

  const [startH, startM] = String(config.start_time).split(":").map(Number);
  const [endH, endM] = String(config.end_time).split(":").map(Number);
  const startMinutes = startH * 60 + (startM || 0);
  const endMinutes = endH * 60 + (endM || 0);

  const disabledDates = new Set(parseJsonArray<string>(config.disabled_dates).map(String));
  const disabledSlots = new Set(
    parseJsonArray<{ date?: string; slot_date?: string; start?: string; slot_start?: string }>(
      config.disabled_slots
    ).map((x) => `${String(x.date ?? x.slot_date ?? "")}|${String(x.start ?? x.slot_start ?? "")}`)
  );

  const out: Array<{
    id: string;
    seller_id: string;
    slot_date: string;
    slot_start: string;
    slot_end: string;
    is_enabled: boolean;
    date_disabled: boolean;
  }> = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let day = 0; day < daysAhead; day++) {
    const d = new Date(today);
    d.setDate(today.getDate() + day);
    const dateStr = toIsoDate(d);
    const dateDisabled = disabledDates.has(dateStr);
    let cur = startMinutes;
    while (cur + duration <= endMinutes) {
      const slotStart = `${String(Math.floor(cur / 60)).padStart(2, "0")}:${String(cur % 60).padStart(2, "0")}`;
      const slotEndMin = cur + duration;
      const slotEnd = `${String(Math.floor(slotEndMin / 60)).padStart(2, "0")}:${String(slotEndMin % 60).padStart(2, "0")}`;
      const key = `${dateStr}|${slotStart}`;
      const isEnabled = !dateDisabled && !disabledSlots.has(key);
      out.push({
        id: `${dateStr}_${slotStart}`,
        seller_id: config.seller_id,
        slot_date: dateStr,
        slot_start: slotStart,
        slot_end: slotEnd,
        is_enabled: isEnabled,
        date_disabled: dateDisabled,
      });
      cur += duration;
    }
  }
  return out;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action, seller_id } = body;

    if (!seller_id) {
      return new Response(JSON.stringify({ error: "seller_id required" }), { status: 400 });
    }

    const sb = createClient(supabaseUrl, supabaseServiceKey);

    if (action === "get_slots") {
      const { data: config, error } = await sb
        .from("seller_schedule_configs")
        .select("*")
        .eq("seller_id", seller_id)
        .single();
      if (error || !config) {
        return new Response(JSON.stringify({ slots: [] }), { status: 200 });
      }
      const slots = buildVirtualSlots(config as ScheduleConfigRow);
      return new Response(JSON.stringify({ slots }), { status: 200 });
    }

    if (action === "save_config") {
      let { start_time, end_time, slot_duration_minutes, days_ahead } = body;
      const todayStr = toIsoDate(new Date());
      const n =
        days_ahead != null && Number(days_ahead) > 0
          ? Math.min(60, Math.max(1, parseInt(String(days_ahead), 10)))
          : 7;

      const fromD = new Date(todayStr + "T12:00:00");
      const toD = new Date(fromD);
      toD.setDate(toD.getDate() + n - 1);
      const date_from = todayStr;
      const date_to = toIsoDate(toD);

      if (!start_time || !end_time) {
        return new Response(JSON.stringify({ error: "All schedule fields required" }), { status: 400 });
      }

      const duration = slot_duration_minutes || 60;

      // Upsert config
      await sb.from("seller_schedule_configs").upsert({
        seller_id,
        date_from,
        date_to,
        start_time,
        end_time,
        slot_duration_minutes: duration,
        days_ahead: n,
      }, { onConflict: "seller_id" });

      const slots_created = buildVirtualSlots({
        seller_id,
        date_from,
        date_to,
        start_time,
        end_time,
        slot_duration_minutes: duration,
        days_ahead: n,
        disabled_dates: [],
        disabled_slots: [],
      }).length;

      return new Response(JSON.stringify({ success: true, slots_created }), { status: 200 });
    }

    if (action === "toggle_slot") {
      const { slot_date, slot_start, is_enabled } = body;
      if (!slot_date || !slot_start) {
        return new Response(JSON.stringify({ error: "slot_date and slot_start required" }), { status: 400 });
      }
      const { data: cfg, error } = await sb
        .from("seller_schedule_configs")
        .select("disabled_slots")
        .eq("seller_id", seller_id)
        .single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      const disabled = parseJsonArray<any>(cfg?.disabled_slots);
      const key = `${String(slot_date)}|${String(slot_start).substring(0, 5)}`;
      const next = disabled.filter((x) => `${String(x.date ?? x.slot_date ?? "")}|${String(x.start ?? x.slot_start ?? "").substring(0, 5)}` !== key);
      if (is_enabled === false) {
        next.push({ date: String(slot_date), start: String(slot_start).substring(0, 5) });
      }
      await sb.from("seller_schedule_configs").update({ disabled_slots: next }).eq("seller_id", seller_id);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    if (action === "toggle_date") {
      const { slot_date, date_disabled } = body;
      if (!slot_date) return new Response(JSON.stringify({ error: "slot_date required" }), { status: 400 });
      const { data: cfg, error } = await sb
        .from("seller_schedule_configs")
        .select("disabled_dates")
        .eq("seller_id", seller_id)
        .single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      const disabled = new Set(parseJsonArray<string>(cfg?.disabled_dates).map(String));
      if (date_disabled) disabled.add(String(slot_date));
      else disabled.delete(String(slot_date));
      await sb
        .from("seller_schedule_configs")
        .update({ disabled_dates: Array.from(disabled) })
        .eq("seller_id", seller_id);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
