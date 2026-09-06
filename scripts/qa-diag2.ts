import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
async function main(){
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  // Trigger seller OTP
  await sb.from("sellers").delete().in("phone", ["+919000000001","919000000001","9000000001"]);
  const r = await fetch("http://127.0.0.1:4321/api/auth/verify-otp",{method:"POST",headers:{"content-type":"application/json","Origin":"http://127.0.0.1:4321"},body:JSON.stringify({phone:"+919000000001",code:"123456",role:"seller"})});
  console.log("resp:", r.status, await r.text());
  const { data } = await sb.from("sellers").select("id,phone,is_active").in("phone",["+919000000001","919000000001","9000000001"]);
  console.log("rows:", JSON.stringify(data, null, 2));
  // cleanup
  await sb.from("sellers").delete().in("phone", ["+919000000001","919000000001","9000000001"]);
}
main().then(()=>process.exit(0));
