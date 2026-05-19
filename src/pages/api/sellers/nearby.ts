import type { APIRoute } from "astro";
import { supabase } from "../../../lib/supabase";
import { isSellerEffectivelyOpen, isPreorderShoppingWindow } from "../../../lib/order-timing";

// Aggregate seller status for empty-state messaging on V2 home.
// Returns: open_count, closed_count, preorder_count, opening_in_minutes (next opener)
export const GET: APIRoute = async ({ url }) => {
  const lat = parseFloat(url.searchParams.get("lat") || "");
  const lng = parseFloat(url.searchParams.get("lng") || "");
  const radius = parseFloat(url.searchParams.get("radius_km") || "10");

  try {
    const { data: sellers, error } = await supabase
      .from("sellers")
      .select("id, name, lat, lng, opens_at, closes_at, accepts_preorder, open_days, preorder_days, preorder_cutoff_time, has_delivery, delivery_rad")
      .eq("is_active", true)
      .neq("name", "New Seller");

    if (error) throw error;

    // Distance filter
    const inRange = (sellers || []).filter((s: any) => {
      if (!isFinite(lat) || !isFinite(lng) || s.lat == null || s.lng == null) return true;
      const dLat = (s.lat - lat) * Math.PI / 180;
      const dLng = (s.lng - lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(s.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return km <= radius;
    });

    // Status check — all using IST via order-timing.ts
    const nowMs = Date.now();
    function minsUntilOpen(s: any): number {
      if (!s.opens_at) return Infinity;
      const nowISTMs = nowMs + 5.5 * 60 * 60 * 1000;
      const nowIST = new Date(nowISTMs);
      const cur = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
      const [h, m] = s.opens_at.split(":").map(Number);
      const o = h * 60 + m;
      if (o > cur) return o - cur;
      return 24 * 60 - cur + o;
    }

    const open = inRange.filter((s: any) => isSellerEffectivelyOpen(s, nowMs));
    const closed = inRange.filter((s: any) => !isSellerEffectivelyOpen(s, nowMs));
    const preorderAvailable = inRange.filter((s: any) => isPreorderShoppingWindow(s, nowMs));

    const nextOpener = closed.reduce((min: number, s: any) => Math.min(min, minsUntilOpen(s)), Infinity);

    return new Response(
      JSON.stringify({
        success: true,
        total: inRange.length,
        open_count: open.length,
        closed_count: closed.length,
        preorder_count: preorderAvailable.length,
        opening_in_minutes: nextOpener === Infinity ? null : nextOpener,
        radius_km: radius,
      }),
      { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const prerender = false;
