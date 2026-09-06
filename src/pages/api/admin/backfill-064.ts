import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const ADMIN_SECRET = import.meta.env.ADMIN_SECRET || "";

/**
 * POST /api/admin/backfill-064
 * Auth: Bearer $ADMIN_SECRET
 * Body: { dry_run?: boolean }
 *
 * Runs the two UPDATE portions of migration 064 against the LIVE Supabase
 * (whichever project the deployed env points to). Idempotent — WHERE clauses
 * already exclude rows that have been backfilled.
 *
 * The CHECK CONSTRAINT (ALTER TABLE) still needs to be applied in the
 * Supabase SQL editor separately — supabase-js REST doesn't do DDL.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!ADMIN_SECRET) return new Response(JSON.stringify({ error: "ADMIN_SECRET not configured" }), { status: 503 });
  const auth = request.headers.get("authorization") || "";
  if (auth !== `Bearer ${ADMIN_SECRET}`) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  let body: { dry_run?: boolean } = {};
  try { body = await request.json(); } catch {}
  const dryRun = !!body.dry_run;

  const sb = createClient(supabaseUrl, supabaseServiceKey);

  // BEFORE COUNT: how many rows currently violate the invariant
  const { count: before, error: e0 } = await sb.from("orders").select("id", { count: "exact", head: true })
    .eq("status", "confirmed")
    .is("razorpay_payment_id", null)
    .is("payment_verified_at", null);
  if (e0) return new Response(JSON.stringify({ error: e0.message }), { status: 500 });

  if (dryRun) {
    return new Response(JSON.stringify({ ok: true, dry_run: true, would_backfill_count: before ?? 0 }), { status: 200 });
  }

  // BACKFILL 1: pre-Razorpay legacy (created < 2026-05-15 AND paid_amount NULL/0)
  const { data: b1, error: e1 } = await sb.from("orders")
    .update({ payment_method: "cod_legacy", payment_verified_at: new Date().toISOString(), payment_verified_by: "legacy_backfill" })
    .eq("status", "confirmed")
    .is("razorpay_payment_id", null)
    .is("payment_verified_at", null)
    .or("paid_amount.is.null,paid_amount.eq.0")
    .lt("created_at", "2026-05-15")
    .select("id");
  if (e1) return new Response(JSON.stringify({ error: `backfill1: ${e1.message}` }), { status: 500 });

  // BACKFILL 2: partial-paid rows (paid_amount > 0) — stamp verified_at from created_at
  // supabase-js can't set field = other_field, so fetch then update per row
  const { data: cwp } = await sb.from("orders")
    .select("id, created_at, payment_verified_by")
    .eq("status", "confirmed")
    .is("razorpay_payment_id", null)
    .is("payment_verified_at", null)
    .gt("paid_amount", 0);
  const b2 = [];
  for (const row of (cwp || [])) {
    const { error: eR } = await sb.from("orders").update({
      payment_verified_at: (row as any).created_at,
      payment_verified_by: (row as any).payment_verified_by || "legacy_backfill_paid",
    }).eq("id", (row as any).id);
    if (!eR) b2.push((row as any).id);
  }

  // AFTER COUNT
  const { count: after } = await sb.from("orders").select("id", { count: "exact", head: true })
    .eq("status", "confirmed")
    .is("razorpay_payment_id", null)
    .is("payment_verified_at", null);

  return new Response(JSON.stringify({
    ok: true,
    dry_run: false,
    before_count: before ?? 0,
    backfill1_rows: b1?.length ?? 0,
    backfill2_rows: b2.length,
    after_count: after ?? 0,
    note: after && after > 0
      ? "Still " + after + " rows violating — inspect + fix manually"
      : "SAFE to apply CHECK CONSTRAINT via Supabase SQL editor",
    next_step_sql: "ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_confirmed_needs_payment; ALTER TABLE orders ADD CONSTRAINT orders_confirmed_needs_payment CHECK (status <> 'confirmed' OR razorpay_payment_id IS NOT NULL OR payment_verified_at IS NOT NULL OR payment_method = 'cod_legacy') NOT VALID; ALTER TABLE orders VALIDATE CONSTRAINT orders_confirmed_needs_payment;",
  }, null, 2), { status: 200 });
};
