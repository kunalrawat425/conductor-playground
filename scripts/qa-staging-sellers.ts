import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const { data } = await sb.from("sellers")
    .select("id,name,phone,is_active,location,location_name,lat,lng,opens_at,closes_at,has_pickup,has_delivery,delivery_rad,min_order_amount,upi_id")
    .order("name");
  for (const s of (data || []) as any[]) {
    console.log(`${s.is_active ? "ACTIVE  " : "inactive"} | ${s.name}`);
    console.log(`         id=${s.id}`);
    console.log(`         phone=${s.phone}  area="${s.location_name}"  addr="${s.location}"`);
    console.log(`         lat=${s.lat} lng=${s.lng}  hours=${s.opens_at}-${s.closes_at}  radius=${s.delivery_rad}km`);
    console.log("");
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
