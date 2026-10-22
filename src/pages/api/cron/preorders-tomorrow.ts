import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { SLOT_SELLER_COLUMNS, tomorrowPreorders } from "../../../lib/delivery-slots";
import { internalHeaders } from "../../../lib/server/internal-auth";

export const prerender = false;

/**
 * Daily 8 PM IST (vercel.json cron): push each seller "Tomorrow: N pre-orders, first slot 9–11 AM"
 * when pre-orders are due the next morning (slot date, else the pre-order delivery morning).
 * Auth: `Authorization: Bearer $CRON_SECRET` (Vercel cron sends it). `?dry_run=1` returns the plan.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const secret = import.meta.env.CRON_SECRET || "";
  if (!secret) return new Response("CRON_SECRET not configured", { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const dryRun = url.searchParams.get("dry_run") === "1";
  const sb = createClient(import.meta.env.PUBLIC_SUPABASE_URL || "", import.meta.env.SUPABASE_SERVICE_KEY || "");

  // Live pre-orders from the last 10 days (3 delivery days ahead is at most ~10 days out).
  const { data: rows, error } = await sb.from("orders")
    .select("id, cart_id, status, is_preorder, placement_kind, created_at, delivery_slot_start, delivery_slot_end, listing:fish_listings(seller_id)")
    .eq("is_preorder", true).in("status", ["paid", "confirmed", "payment_required"])
    .gte("created_at", new Date(Date.now() - 10 * 86_400_000).toISOString());
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const bySeller = new Map<string, any[]>();
  for (const r of rows || []) {
    const sid = (r as any).listing?.seller_id;
    if (sid) bySeller.set(sid, [...(bySeller.get(sid) || []), r]);
  }
  if (!bySeller.size) return Response.json({ ok: true, sellers: 0, sent: 0 });

  const { data: sellers } = await sb.from("sellers").select(`id, ${SLOT_SELLER_COLUMNS}`).in("id", [...bySeller.keys()]);
  const plan = (sellers || []).map((s: any) => ({ seller_id: s.id, ...tomorrowPreorders(bySeller.get(s.id) || [], s) }))
    .filter((p) => p.count > 0);
  if (dryRun) return Response.json({ ok: true, dry_run: true, plan });

  let sent = 0;
  for (const p of plan) {
    try {
      const res = await fetch(`${url.origin}/api/notify-seller`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...internalHeaders() },
        body: JSON.stringify({ kind: "preorders_tomorrow", seller_id: p.seller_id, item_count: p.count, first_slot: p.firstSlot }),
      });
      const j: any = await res.json().catch(() => ({}));
      if (res.ok && !j?.skipped) sent++;
    } catch (err: any) {
      console.warn("[cron/preorders-tomorrow] notify-seller failed", { seller_id: p.seller_id, err: err?.message });
    }
  }
  return Response.json({ ok: true, sellers: plan.length, sent });
};
