// Prod diagnostics. Requires PROD_SUPABASE_URL + PROD_SUPABASE_SECRET_KEY in .env (gitignored).
// Never hardcode Supabase keys here — GitHub Push Protection will (correctly) block the push.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PROD_SUPABASE_URL!, process.env.PROD_SUPABASE_SECRET_KEY!);
async function main() {
  // Health
  const { count: pending } = await sb.from("orders").select("id", { count: "exact", head: true }).in("status", ["pending","pending_payment"]);
  const { count: orphans } = await sb.from("orders").select("id", { count: "exact", head: true }).in("status", ["pending","pending_payment"]).not("razorpay_order_id","is",null);
  const { count: violators } = await sb.from("orders").select("id", { count: "exact", head: true }).eq("status","confirmed").is("razorpay_payment_id",null).is("payment_verified_at",null);
  const { count: legacyBackfilled } = await sb.from("orders").select("id", { count: "exact", head: true }).eq("payment_method","cod_legacy");
  console.log("PROD DB STATE:");
  console.log("  pending orders:      ", pending);
  console.log("  orphan razorpay:     ", orphans);
  console.log("  invariant violators: ", violators, "(needs 0 for CHECK CONSTRAINT)");
  console.log("  cod_legacy backfilled:", legacyBackfilled);
  // B3F1CCED verify
  const { data: b3 } = await sb.from("orders").select("id, status, refund_amt, refund_sent_at, razorpay_payment_id").eq("id","b3f1cced-8929-42aa-8aec-434689309b2e").single();
  console.log("\nB3F1CCED state:", JSON.stringify(b3, null, 2));
  // Any recent activity? last 5 orders
  const { data: recent } = await sb.from("orders").select("id, status, created_at").order("created_at", { ascending: false }).limit(5);
  console.log("\nLast 5 orders on prod:");
  recent?.forEach(r => console.log(`  ${(r as any).id.slice(0,8)} ${(r as any).status} ${(r as any).created_at}`));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
