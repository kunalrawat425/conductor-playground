import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

/**
 * GET /api/health
 * Public health snapshot. Returns:
 *   - env flags (razorpay enabled, msg91 enabled, webhook secret set)
 *   - Supabase reachability
 *   - counts of key row types
 *
 * Cheap: 2 count queries. Safe for uptime monitors + Slack /health.
 * No auth — never returns secrets, only booleans + counts.
 */
export const GET: APIRoute = async () => {
  const t0 = Date.now();
  const url = import.meta.env.PUBLIC_SUPABASE_URL || "";
  const key = import.meta.env.SUPABASE_SERVICE_KEY || "";

  const env = {
    razorpay_enabled: import.meta.env.PUBLIC_ENABLE_RAZORPAY === "true",
    msg91_enabled: import.meta.env.PUBLIC_ENABLE_MSG91 === "true",
    webhook_secret_set: !!import.meta.env.RAZORPAY_WEBHOOK_SECRET,
    admin_secret_set: !!import.meta.env.ADMIN_SECRET,
    cron_secret_set: !!import.meta.env.CRON_SECRET,
    supabase_configured: !!url && !!key,
  };

  const health: Record<string, unknown> = { ok: true, env, elapsed_ms: 0 };

  if (env.supabase_configured) {
    try {
      const sb = createClient(url, key);
      const [{ count: pending }, { count: orphans }] = await Promise.all([
        sb.from("orders").select("id", { count: "exact", head: true }).in("status", ["pending", "pending_payment"]),
        sb.from("orders").select("id", { count: "exact", head: true }).in("status", ["pending", "pending_payment"]).not("razorpay_order_id", "is", null),
      ]);
      health.db = { reachable: true, pending_orders: pending ?? 0, orphan_razorpay: orphans ?? 0 };
    } catch (err: any) {
      health.db = { reachable: false, err: err?.message || "unknown" };
      health.ok = false;
    }
  } else {
    health.db = { reachable: false, err: "supabase not configured" };
    health.ok = false;
  }

  health.elapsed_ms = Date.now() - t0;
  return new Response(JSON.stringify(health, null, 2), {
    status: health.ok ? 200 : 503,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
