import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
async function main(){
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const { data } = await sb.from("buyers").select("*").limit(1);
  console.log("buyer cols:", data?.[0] ? Object.keys(data[0]).sort().join(",") : "none");
}
main().then(()=>process.exit(0));
