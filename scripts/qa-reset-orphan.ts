import { createClient } from "@supabase/supabase-js";
import { config as dotenv } from "dotenv";
dotenv();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const ORDER = "c00a9d6b-f7a0-47da-ad2a-a270cf07b2c7";

async function main() {
  const { data: before } = await sb.from("orders").select("id, status, razorpay_order_id, razorpay_payment_id, payment_verified_at").eq("id", ORDER).single();
  console.log("BEFORE:", before);

  const { error } = await sb.from("orders").update({
    razorpay_order_id: null,
    razorpay_payment_id: null,
    payment_verified_at: null,
    payment_method: null,
    status: "pending_payment",
  }).eq("id", ORDER);
  if (error) { console.error(error); process.exit(1); }

  const { data: after } = await sb.from("orders").select("id, status, razorpay_order_id, razorpay_payment_id, payment_verified_at").eq("id", ORDER).single();
  console.log("AFTER: ", after);
}
main().then(() => process.exit(0));
