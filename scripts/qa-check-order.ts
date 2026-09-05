import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data } = await sb.from("orders").select("id,status,payment_method,razorpay_order_id,razorpay_payment_id,payment_verified_at").eq("id","c00a9d6b-f7a0-47da-ad2a-a270cf07b2c7").single();
console.log(JSON.stringify(data,null,2));
