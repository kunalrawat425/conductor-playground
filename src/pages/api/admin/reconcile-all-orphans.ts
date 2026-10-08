import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const RAZORPAY_KEY_ID = import.meta.env.PUBLIC_RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = import.meta.env.RAZORPAY_KEY_SECRET || "";
const ADMIN_SECRET = import.meta.env.ADMIN_SECRET || "";

/**
 * POST /api/admin/reconcile-all-orphans
 *
 * Auth: `Authorization: Bearer $ADMIN_SECRET`
 * Body: { dry_run?: boolean }  — default false
 *
 * Bulk-scan every order with `razorpay_order_id` set + status in
 * (pending, pending_payment). For each, hit Razorpay for captured payments;
 * if a captured payment exists, flip DB row to confirmed.
 *
 * One-time cleanup for the orphan class BEFORE webhook was live.
 * Idempotent — safe to run repeatedly.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "ADMIN_SECRET not configured" }), { status: 503 });
  }
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${ADMIN_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body: { dry_run?: boolean } = {};
  try { body = await request.json(); } catch {}
  const dryRun = !!body.dry_run;

  const sb = createClient(supabaseUrl, supabaseServiceKey);
  const rzpAuth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");

  const { data: orphans, error } = await sb
    .from("orders")
    .select("id, razorpay_order_id, buyer_id, buyer_phone, species, status")
    .not("razorpay_order_id", "is", null)
    .in("status", ["pending", "pending_payment"]);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const report: Array<{ order_id: string; rzp_order: string; reconciled: boolean; reason?: string; pay_id?: string }> = [];
  let flipped = 0;

  for (const o of (orphans || [])) {
    const rzpOrder = (o as any).razorpay_order_id;
    let res: Response;
    try {
      res = await fetch(`https://api.razorpay.com/v1/orders/${rzpOrder}/payments`, {
        headers: { Authorization: `Basic ${rzpAuth}` },
      });
    } catch (err: any) {
      report.push({ order_id: (o as any).id, rzp_order: rzpOrder, reconciled: false, reason: `network: ${err?.message}` });
      continue;
    }
    if (!res.ok) {
      report.push({ order_id: (o as any).id, rzp_order: rzpOrder, reconciled: false, reason: `razorpay ${res.status}` });
      continue;
    }
    const rzpData = await res.json();
    const captured = Array.isArray(rzpData.items)
      ? rzpData.items.find((p: any) => p?.status === "captured")
      : null;
    if (!captured) {
      report.push({ order_id: (o as any).id, rzp_order: rzpOrder, reconciled: false, reason: "no captured payment at razorpay" });
      continue;
    }
    if (dryRun) {
      report.push({ order_id: (o as any).id, rzp_order: rzpOrder, reconciled: true, reason: "dry-run — would flip", pay_id: captured.id });
      flipped += 1;
      continue;
    }

    try {
      const { settleCapturedPayment } = await import("../../../lib/server/razorpay-ledger");
      const r = await settleCapturedPayment(sb, { razorpay_order_id: rzpOrder, razorpay_payment_id: captured.id, source: "admin" });
      report.push({ order_id: (o as any).id, rzp_order: rzpOrder, reconciled: r.kind === "confirmed", reason: r.kind, pay_id: captured.id });
      if (r.kind === "confirmed") flipped += 1;
    } catch (err: any) {
      report.push({ order_id: (o as any).id, rzp_order: rzpOrder, reconciled: false, reason: `settle: ${err?.message}` });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    dry_run: dryRun,
    total_orphans: (orphans || []).length,
    flipped,
    report,
  }, null, 2), { status: 200 });
};
