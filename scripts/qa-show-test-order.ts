import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
import { readFileSync } from "node:fs";
async function main() {
  const id = readFileSync("/tmp/test-order-id.txt", "utf8").trim();
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const { data } = await sb.from("orders")
    .select("id,status,total_price,quantity,quantity_unit,order_type,razorpay_order_id,razorpay_payment_id,payment_verified_at,listing:fish_listings(species,seller:sellers(name,phone))")
    .eq("id", id).single();
  const d: any = data;
  console.log("TEST ORDER:");
  console.log("  order id   :", d.id);
  console.log("  seller     :", d.listing?.seller?.name, "(" + d.listing?.seller?.phone + ")");
  console.log("  item       :", d.quantity, d.quantity_unit, d.listing?.species);
  console.log("  amount     : Rs", d.total_price);
  console.log("  fulfilment :", d.order_type, "(no address needed)");
  console.log("  status     :", d.status);
  console.log("  rzp order  :", d.razorpay_order_id);
  console.log("  paid?      :", d.payment_verified_at ? "YES " + d.payment_verified_at : "not yet");
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
