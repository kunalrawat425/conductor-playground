import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { notifyOrderParties } from "../../../lib/server/notify-order-parties";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const RAZORPAY_KEY_ID = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = import.meta.env.RAZORPAY_KEY_SECRET || "";
const CRON_SECRET = import.meta.env.CRON_SECRET || "";

/**
 * Hourly cron: auto-reconcile orphan Razorpay payments.
 * Redundant with the webhook (which reconciles instantly) but catches:
 *   - Events lost due to webhook downtime
 *   - Rows created before webhook was live
 *   - Any Razorpay retry-exhausted delivery
 *
 * Scans only orders WHERE razorpay_order_id IS NOT NULL AND status IN
 * (pending, pending_payment) AND created_at < NOW() - 5 minutes
 * (grace period so we don't race the webhook).
 *
 * Vercel schedule (add to vercel.json):
 *   { "path": "/api/cron/reconcile-orphans", "schedule": "17 * * * *" }
 *
 * Auth: Authorization: Bearer $CRON_SECRET.
 */
async function run(request: Request, origin: string) {
  if (!CRON_SECRET) return new Response(JSON.stringify({ error: "CRON_SECRET not configured" }), { status: 503 });
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${CRON_SECRET}`) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const sb = createClient(supabaseUrl, supabaseServiceKey);
  const rzpAuth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  const graceCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data: orphans, error } = await sb
    .from("orders")
    .select("id, razorpay_order_id")
    .not("razorpay_order_id", "is", null)
    .in("status", ["pending", "pending_payment"])
    .lt("created_at", graceCutoff)
    .limit(100);
  if (error) {
    console.error("[cron/reconcile-orphans] scan failed", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let flipped = 0, skipped = 0, errors = 0;
  for (const o of (orphans || [])) {
    const rzpOrder = (o as any).razorpay_order_id;
    let res: Response;
    try {
      res = await fetch(`https://api.razorpay.com/v1/orders/${rzpOrder}/payments`, {
        headers: { Authorization: `Basic ${rzpAuth}` },
      });
    } catch { errors++; continue; }
    if (!res.ok) { errors++; continue; }
    const rzpData = await res.json();
    const captured = Array.isArray(rzpData.items) ? rzpData.items.find((p: any) => p?.status === "captured") : null;
    if (!captured) { skipped++; continue; }
    // BUG-34: `payment_verified_by` is uuid, so "cron_reconcile" raised 22P02
    // and every UPDATE was rejected. The error was discarded, so this cron
    // reported flipped=0 forever and had never once recovered an order — the
    // exact job meant to be the last line of defence for a captured payment.
    // Actor is recorded in the log line instead; the column stays null.
    const { data: upd, error: updErr } = await sb
      .from("orders")
      .update({
        status: "confirmed",
        payment_method: "razorpay",
        razorpay_payment_id: captured.id,
        payment_verified_at: new Date().toISOString(),
        payment_verified_by: null,
      })
      .eq("id", (o as any).id)
      .in("status", ["pending", "pending_payment"])
      .select("id");

    if (updErr) {
      console.error("[cron/reconcile-orphans] update failed", { order_id: (o as any).id, err: updErr.message });
      errors++;
      continue;
    }
    if ((upd?.length ?? 0) > 0) {
      flipped++;
      console.log(`[cron/reconcile-orphans] recovered ${(o as any).id} via payment ${captured.id}`);
      // The buyer paid, the client handler dropped and the webhook missed it —
      // this is the last chance anyone gets told. Previously: nobody was.
      await notifyOrderParties({ order_id: (o as any).id, event: "payment_confirmed", origin })
        .catch((err: any) => console.warn("[cron/reconcile-orphans] notify failed", { order_id: (o as any).id, err: err?.message }));
    }
  }

  console.log(`[cron/reconcile-orphans] scanned=${orphans?.length ?? 0} flipped=${flipped} skipped=${skipped} errors=${errors}`);
  return new Response(JSON.stringify({ ok: true, scanned: orphans?.length ?? 0, flipped, skipped, errors }), { status: 200 });
}

export const GET: APIRoute = async ({ request, url }) => run(request, url.origin);
export const POST: APIRoute = async ({ request, url }) => run(request, url.origin);
