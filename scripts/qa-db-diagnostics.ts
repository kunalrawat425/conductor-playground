/**
 * QA DB diagnostics — read-only Supabase queries to establish the pre-QA
 * baseline for the payment-not-reflected investigation.
 *
 * Requires: .env with PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY.
 * Run:      node --import tsx scripts/qa-db-diagnostics.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config as dotenv } from "dotenv";

dotenv();

const url = process.env.PUBLIC_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_KEY || "";
if (!url || !key) {
  console.error("Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env");
  process.exit(1);
}
const sb = createClient(url, key);

type Row = Record<string, unknown>;

async function section(title: string, fn: () => Promise<Row[] | null>) {
  console.log(`\n===== ${title} =====`);
  const rows = await fn();
  if (!rows) return;
  console.log(`count: ${rows.length}`);
  if (rows.length) console.table(rows.slice(0, 20));
}

async function orphanRazorpay() {
  const { data, error } = await sb
    .from("orders")
    .select("id, buyer_id, status, razorpay_order_id, razorpay_payment_id, payment_verified_at, created_at")
    .not("razorpay_order_id", "is", null)
    .in("status", ["pending", "pending_payment"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) { console.error(error); return null; }
  return data as Row[];
}

async function confirmedWithoutPayment() {
  const { data, error } = await sb
    .from("orders")
    .select("id, status, payment_method, payment_verified_at, razorpay_payment_id, paid_amount, created_at")
    .eq("status", "confirmed")
    .is("razorpay_payment_id", null)
    .is("payment_verified_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) { console.error(error); return null; }
  return data as Row[];
}

async function screenshotUnverified() {
  const { data, error } = await sb
    .from("orders")
    .select("id, buyer_id, status, payment_screenshot_urls, created_at")
    .not("payment_screenshot_urls", "is", null)
    .is("payment_verified_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) { console.error(error); return null; }
  return (data as Row[]).filter(r => Array.isArray(r.payment_screenshot_urls) && (r.payment_screenshot_urls as unknown[]).length > 0);
}

async function stalePendingPayment() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("orders")
    .select("id, status, buyer_id, created_at")
    .in("status", ["pending", "pending_payment"])
    .lt("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) { console.error(error); return null; }
  return data as Row[];
}

async function schemaSanity() {
  const { data, error } = await sb
    .from("orders")
    .select("id, status, payment_method, razorpay_order_id, razorpay_payment_id, payment_verified_at, payment_screenshot_urls, paid_amount, final_price")
    .limit(1);
  if (error) { console.error("Schema check failed:", error); return null; }
  console.log("Sample row keys:", Object.keys((data?.[0] as Row) || {}));
  return null;
}

async function main() {
  await section("Schema sanity (one row from orders)", schemaSanity);
  await section("Orphan Razorpay payments (created but never verified)", orphanRazorpay);
  await section("Orders confirmed without a payment record", confirmedWithoutPayment);
  await section("Screenshot uploaded but seller never verified", screenshotUnverified);
  await section("Stale pending_payment older than 24h", stalePendingPayment);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
