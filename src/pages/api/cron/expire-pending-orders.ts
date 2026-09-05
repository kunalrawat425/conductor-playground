import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const CRON_SECRET = import.meta.env.CRON_SECRET || "";

/**
 * Nightly cron: auto-cancel `pending_payment` orders older than 24h
 * that never got a Razorpay order created (buyer walked away pre-payment).
 *
 * Rows with `razorpay_order_id` set are LEFT ALONE — they may still capture
 * via the webhook (razorpay-webhook.ts) or manual reconcile.
 *
 * Vercel cron schedule (add to vercel.json):
 *   { "path": "/api/cron/expire-pending-orders", "schedule": "0 3 * * *" }
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` (Vercel Cron injects this).
 */
async function run(request: Request) {
  if (!CRON_SECRET) {
    return new Response(JSON.stringify({ error: "CRON_SECRET not configured" }), { status: 503 });
  }
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const sb = createClient(supabaseUrl, supabaseServiceKey);
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("orders")
    .update({ status: "cancelled", cancel_reason: "auto_expired_payment", cancelled_by: "system" })
    .in("status", ["pending", "pending_payment"])
    .is("razorpay_order_id", null)
    .lt("created_at", cutoff)
    .select("id");

  if (error) {
    console.error("[cron/expire-pending] failed", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const n = data?.length ?? 0;
  console.log(`[cron/expire-pending] expired ${n} orders older than 24h`);
  return new Response(JSON.stringify({ ok: true, expired: n }), { status: 200 });
}

export const GET: APIRoute = async ({ request }) => run(request);
export const POST: APIRoute = async ({ request }) => run(request);
