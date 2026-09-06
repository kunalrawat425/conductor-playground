import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data, error } = await sb.from("orders")
  .update({ status: "pending_payment", cancel_reason: null, cancelled_by: null })
  .eq("cancel_reason", "auto_expired_payment")
  .select("id");
console.log("reverted:", data?.length, "err:", error?.message);
