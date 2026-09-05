import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
async function main(){
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  // Order id starts with b3f1cced (screenshot shows uppercase abbrev)
  const { data } = await sb.from("orders").select("*").ilike("id", "b3f1cced%");
  console.log("orders found:", data?.length);
  if (data) console.log(JSON.stringify(data, null, 2));
}
main().then(()=>process.exit(0));
