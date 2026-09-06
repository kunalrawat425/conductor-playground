import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
async function main() {
  const sb = createClient(process.env.PROD_SUPABASE_URL!, process.env.PROD_SUPABASE_SECRET_KEY!);
  const { data } = await sb.from("sellers")
    .select("id, name, phone, is_active, has_pickup, has_delivery, opens_at, closes_at, open_days, min_order_amount, accepts_preorder, lat, lng, upi_id")
    .eq("id", "337904df-ef4d-4825-b3e6-7767bedf40d2").single();
  console.log(JSON.stringify(data, null, 2));
}
main().then(()=>process.exit(0));
