// Prod diagnostics. Requires PROD_SUPABASE_URL + PROD_SUPABASE_SECRET_KEY in .env (gitignored).
// Never hardcode Supabase keys here — GitHub Push Protection will (correctly) block the push.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PROD_SUPABASE_URL!, process.env.PROD_SUPABASE_SECRET_KEY!);
async function main() {
  const { data, error } = await sb.from("orders").insert({
    status: "confirmed",
    buyer_phone: "+919999999997",
    quantity: 1,
    quantity_unit: "kg",
    total_price: 100,
  }).select("id, status, razorpay_payment_id, payment_verified_at, payment_method, payment_verified_by").single();
  if (error) {
    console.log("REJECTED:", error.message);
  } else {
    console.log("ACCEPTED. Actual stored row:", JSON.stringify(data, null, 2));
    await sb.from("orders").delete().eq("id", (data as any).id);
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
