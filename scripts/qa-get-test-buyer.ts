import { createClient } from "@supabase/supabase-js";
import { config as dotenv } from "dotenv";
dotenv();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function main() {
  // Try any test buyer that's placed an order recently
  const { data: buyers, error: be } = await sb.from("buyers").select("id, phone, email, created_at").order("created_at", { ascending: false }).limit(10);
  console.log("buyers (10):", buyers?.length, be?.message);
  if (buyers) console.table(buyers);

  const { data: listings, error: le } = await sb.from("fish_listings").select("id, species, stock_qty, seller_id").limit(5);
  console.log("\nlistings any (5):", listings?.length, le?.message);
  if (listings) console.table(listings);

  const { data: sellers, error: se } = await sb.from("sellers").select("id, name, is_active, has_delivery, has_pickup, phone").limit(5);
  console.log("\nsellers (5):", sellers?.length, se?.message);
  if (sellers) console.table(sellers);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
