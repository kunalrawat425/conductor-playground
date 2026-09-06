// Prod diagnostics. Requires PROD_SUPABASE_URL + PROD_SUPABASE_SECRET_KEY in .env (gitignored).
// Never hardcode Supabase keys here — GitHub Push Protection will (correctly) block the push.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PROD_SUPABASE_URL!, process.env.PROD_SUPABASE_SECRET_KEY!);
async function main() {
  const { data } = await sb.from("orders").select("id, status, refund_amt, refund_sent_at, razorpay_payment_id, refund_note").eq("id","b3f1cced-8929-42aa-8aec-434689309b2e").single();
  console.log(JSON.stringify(data, null, 2));
  const { count: violators } = await sb.from("orders").select("id", { count: "exact", head: true }).eq("status","confirmed").is("razorpay_payment_id",null).is("payment_verified_at",null);
  const { count: legacyBackfilled } = await sb.from("orders").select("id", { count: "exact", head: true }).eq("payment_method","cod_legacy");
  console.log("\ninvariant violators:", violators, "(needs 0)");
  console.log("cod_legacy backfilled:", legacyBackfilled);
}
main().then(()=>process.exit(0));
