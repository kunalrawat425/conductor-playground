import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data, error } = await sb.from("orders").select("id,status,created_at,total_price,species,is_preorder,placement_kind,buyer_id,buyer_phone,razorpay_order_id").eq("buyer_id","ceeed802-e716-40b3-bc21-bf3b92a5531c").order("created_at",{ascending:false});
console.log("count:", data?.length, "error:", error?.message);
if (data) console.table(data);
