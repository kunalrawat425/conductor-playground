import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
async function main(){
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
// M8-T6: seller cols
const { data: s } = await sb.from("sellers").select("*").limit(1);
console.log("seller cols:", s?.[0] ? Object.keys(s[0]).sort().join(",") : "none");
// M12: push table
const { data: p, error } = await sb.from("buyer_push_subscriptions").select("*").limit(1);
console.log("push table:", p?.length, "err:", error?.message);
// M11-T1: what does preorders API expect?
const r = await fetch("http://127.0.0.1:4321/api/preorders");
console.log("preorders:", r.status, (await r.text()).slice(0,200));
}
main().then(()=>process.exit(0));
