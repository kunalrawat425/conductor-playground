import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
import { readFileSync } from "node:fs";
async function main() {
  const id = readFileSync("/tmp/test-order-id.txt","utf8").trim();
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const { data } = await sb.from("orders").select("*").eq("id", id).single();
  const d: any = data;
  const checks: [string, boolean, string][] = [
    ["status === 'confirmed'", d.status === "confirmed", d.status],
    ["NOT prematurely 'completed'", d.status !== "completed", d.status],
    ["payment_method === 'razorpay'", d.payment_method === "razorpay", String(d.payment_method)],
    ["razorpay_payment_id set (pay_*)", typeof d.razorpay_payment_id === "string" && d.razorpay_payment_id.startsWith("pay_"), String(d.razorpay_payment_id)],
    ["payment_verified_at set", !!d.payment_verified_at, String(d.payment_verified_at)],
    ["no refund fields set", !d.refund_amt && !d.refund_sent_at, `amt=${d.refund_amt} sent=${d.refund_sent_at}`],
    ["not cancelled/declined", !["cancelled","declined","refunded"].includes(d.status), d.status],
  ];
  console.log("E2E PAYMENT VERIFICATION\n");
  let fail = 0;
  for (const [name, ok, actual] of checks) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual}`);
    if (!ok) fail++;
  }
  console.log(`\n${checks.length - fail}/${checks.length} checks passed`);

  // Razorpay side truth
  const auth = Buffer.from(`${process.env.PUBLIC_RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const r = await fetch(`https://api.razorpay.com/v1/payments/${d.razorpay_payment_id}`, { headers: { Authorization: `Basic ${auth}` } });
  if (r.ok) {
    const p: any = await r.json();
    console.log("\nRAZORPAY SIDE:");
    console.log("  payment id :", p.id);
    console.log("  status     :", p.status);
    console.log("  captured   :", p.captured);
    console.log("  amount     : Rs", (p.amount ?? 0)/100);
    console.log("  method     :", p.method);
    console.log("  order id   :", p.order_id);
    console.log("  match DB?  :", p.order_id === d.razorpay_order_id ? "YES" : "NO");
  } else {
    console.log("\nRazorpay lookup failed:", r.status);
  }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e=>{console.error(e);process.exit(1);});
