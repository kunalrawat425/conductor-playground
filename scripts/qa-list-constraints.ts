// Prod diagnostics. Requires PROD_SUPABASE_URL + PROD_SUPABASE_SECRET_KEY in .env (gitignored).
// Never hardcode Supabase keys here — GitHub Push Protection will (correctly) block the push.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PROD_SUPABASE_URL!, process.env.PROD_SUPABASE_SECRET_KEY!);
async function main() {
  // Query pg_constraint via RPC — need a helper function. Use the postgres_meta REST equivalent.
  // Alternative: query information_schema.table_constraints via a plain select isn't allowed.
  // Try one more violating insert with different data to double-check
  const { data, error } = await sb.from("orders").insert({
    status: "confirmed",
    razorpay_payment_id: null,
    payment_verified_at: null,
    payment_method: null,
    buyer_phone: "+919999999998",
    quantity: 1,
    quantity_unit: "kg",
    total_price: 100,
  }).select().single();
  console.log("insert result:", error ? "REJECTED: " + error.message : "ACCEPTED with id " + (data as any).id);
  if (data) {
    await sb.from("orders").delete().eq("id", (data as any).id);
    console.log("(deleted test row)");
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
