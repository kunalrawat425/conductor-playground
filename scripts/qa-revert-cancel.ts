import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
await sb.from("orders").update({ status:"confirmed", cancel_reason:null, cancelled_by:null, refund_note:null }).eq("id","d7aea141-6fc5-465a-a4dd-e4f0a59cc1ac");
const { data } = await sb.from("orders").select("id,status").eq("id","d7aea141-6fc5-465a-a4dd-e4f0a59cc1ac").single();
console.log("reverted:", data);
