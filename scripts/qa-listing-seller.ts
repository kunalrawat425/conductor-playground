import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
async function main(){
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data } = await sb.from("fish_listings").select("id, species, pricing_options, weight_avail, is_available").eq("seller_id","337904df-ef4d-4825-b3e6-7767bedf40d2").eq("is_available", true);
console.log(JSON.stringify(data, null, 2));
}
main().then(()=>process.exit(0));
