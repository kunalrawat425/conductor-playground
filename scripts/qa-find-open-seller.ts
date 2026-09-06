import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const { data } = await sb.from("sellers").select("id, name, opens_at, closes_at, is_active, has_pickup").eq("is_active", true).order("closes_at", { ascending: false });
  console.table(data);
  const { data: listings } = await sb.from("fish_listings").select("id, species, seller_id, weight_avail, pricing_options, is_available").limit(15);
  console.log("\nlistings:"); console.table(listings?.map(l => ({ id: l.id, species: l.species, seller_id: l.seller_id?.slice(0,8), wt: l.weight_avail, avail: l.is_available })));
}
main().then(()=>process.exit(0));
