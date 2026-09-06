import { createClient } from "@supabase/supabase-js";
import { config as dotenv } from "dotenv";
dotenv();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function main() {
  const orphans = ["c00a9d6b-f7a0-47da-ad2a-a270cf07b2c7", "973aae59-2508-48a9-8292-170af1d9977e"];
  const { data } = await sb.from("orders").select("*").in("id", orphans);
  console.log("\n===== ORPHAN RAZORPAY DETAIL =====");
  console.log(JSON.stringify(data, null, 2));

  const { data: recent } = await sb.from("orders").select("id, status, payment_method, razorpay_order_id, razorpay_payment_id, payment_verified_at, paid_amount, total_price, delivery_fee, created_at, buyer_phone")
    .order("created_at", { ascending: false }).limit(15);
  console.log("\n===== 15 MOST RECENT ORDERS =====");
  console.table(recent);

  // Any orders in past 7 days?
  const { data: week } = await sb.from("orders").select("id, status, payment_method, razorpay_payment_id, created_at, buyer_phone, total_price").gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString()).order("created_at", { ascending: false });
  console.log(`\n===== ORDERS PAST 7 DAYS: ${week?.length ?? 0} =====`);
  if (week?.length) console.table(week);

  // Confirmed-without-payment: paid_amount breakdown
  const { data: cwp } = await sb.from("orders").select("id, paid_amount, is_preorder, created_at").eq("status", "confirmed").is("razorpay_payment_id", null).is("payment_verified_at", null).order("created_at", { ascending: false }).limit(200);
  const withPaid = cwp?.filter(r => r.paid_amount != null && Number(r.paid_amount) > 0).length ?? 0;
  const nullPaid = cwp?.filter(r => r.paid_amount == null || Number(r.paid_amount) === 0).length ?? 0;
  const preorder = cwp?.filter(r => r.is_preorder).length ?? 0;
  console.log(`\n===== CONFIRMED-WITHOUT-PAYMENT (n=${cwp?.length ?? 0}) =====`);
  console.log(`  with paid_amount>0: ${withPaid}`);
  console.log(`  paid_amount null/0: ${nullPaid}`);
  console.log(`  is_preorder=true:   ${preorder}`);

  // Webhook check — any 'razorpay_webhook' event trail?
  console.log(`\n===== SEARCH: any razorpay_webhook table? =====`);
  const { data: tables, error } = await sb.rpc("pg_tables_public").select("*").limit(1);
  if (error) console.log("(pg_tables_public RPC absent — expected)");

  // Get schema of orders to see all payment cols
  const { data: sample } = await sb.from("orders").select("*").limit(1);
  console.log(`\n===== ORDERS COLUMNS =====`);
  console.log(sample?.[0] ? Object.keys(sample[0]).sort().join(", ") : "no rows");
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
