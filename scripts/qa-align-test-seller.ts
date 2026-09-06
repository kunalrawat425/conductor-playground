// Aligns the STAGING Rs1 test seller (Seller 9974) to Fish Tokri's location.
// Staging only — reads PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY from .env.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();

const TEST_SELLER = "337904df-ef4d-4825-b3e6-7767bedf40d2"; // Seller 9974
const FISHTOKRI  = "2f39dfce-15c0-4f9a-a5b3-e95280479dbd"; // Fish Tokri

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  const { data: ft } = await sb.from("sellers")
    .select("location, location_name, lat, lng, delivery_rad").eq("id", FISHTOKRI).single();
  if (!ft) throw new Error("Fish Tokri not found");
  const f: any = ft;

  const { data: before } = await sb.from("sellers")
    .select("name, location_name, lat, lng").eq("id", TEST_SELLER).single();
  console.log("BEFORE:", JSON.stringify(before));

  const { data: after, error } = await sb.from("sellers").update({
    name: "QA Test Seller (Thane)",
    location: f.location,
    location_name: f.location_name,
    lat: f.lat,
    lng: f.lng,
    delivery_rad: f.delivery_rad,
    is_active: true,
    has_pickup: true,
    has_delivery: true,
    min_order_amount: 0,
  }).eq("id", TEST_SELLER)
    .select("id, name, phone, location_name, location, lat, lng, delivery_rad, is_active, opens_at, closes_at, has_pickup, has_delivery, min_order_amount")
    .single();

  if (error) throw error;
  console.log("\nAFTER:");
  console.log(JSON.stringify(after, null, 2));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
