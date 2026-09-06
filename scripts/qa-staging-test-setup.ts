// Verifies staging has an active seller + cheap listing for E2E payment test.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const { data } = await sb.from("fish_listings")
    .select("id, species, pricing_options, weight_avail, is_available, seller:sellers(id,name,phone,is_active,has_pickup,has_delivery,opens_at,closes_at,min_order_amount)")
    .eq("is_available", true);
  const cheap: any[] = [];
  for (const l of (data || []) as any[]) {
    for (const o of (Array.isArray(l.pricing_options) ? l.pricing_options : [])) {
      const p = Number(o?.price);
      if (Number.isFinite(p) && p <= 50) cheap.push({
        listing_id: l.id, species: l.species, price: p, unit: o?.unit,
        bundle: o?.bundle_size ?? 1, stock: l.weight_avail,
        seller: l.seller?.name, seller_id: l.seller?.id, phone: l.seller?.phone,
        active: l.seller?.is_active, hours: `${l.seller?.opens_at}-${l.seller?.closes_at}`,
        min_order: l.seller?.min_order_amount,
      });
    }
  }
  cheap.sort((a,b)=>a.price-b.price);
  console.log("STAGING cheap listings:\n" + JSON.stringify(cheap, null, 2));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
