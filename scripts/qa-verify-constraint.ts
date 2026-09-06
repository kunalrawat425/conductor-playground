// Prod diagnostics. Requires PROD_SUPABASE_URL + PROD_SUPABASE_SECRET_KEY in .env (gitignored).
// Never hardcode Supabase keys here — GitHub Push Protection will (correctly) block the push.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PROD_SUPABASE_URL!, process.env.PROD_SUPABASE_SECRET_KEY!);
async function main() {
  // Attempt to INSERT a violating row — should be rejected if constraint is live
  const { error } = await sb.from("orders").insert({
    status: "confirmed",
    razorpay_payment_id: null,
    payment_verified_at: null,
    payment_method: null,
    buyer_phone: "+919999999999",
    quantity: 1,
    quantity_unit: "kg",
    total_price: 100,
  });
  if (error) {
    console.log("PASS: constraint enforced — insert rejected");
    console.log("  err:", error.message);
  } else {
    console.log("FAIL: violating row inserted (rolling back)");
    await sb.from("orders").delete().eq("buyer_phone", "+919999999999");
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
