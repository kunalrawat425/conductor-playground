// Finds low-price test listings on PROD. Creds from .env (gitignored).
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
async function main() {
  const sb = createClient(process.env.PROD_SUPABASE_URL!, process.env.PROD_SUPABASE_SECRET_KEY!);
  const { data } = await sb
    .from("fish_listings")
    .select("id, species, pricing_options, weight_avail, is_available, is_preorder_enabled, seller:sellers(id, name, phone, is_active, has_pickup, has_delivery, opens_at, closes_at, min_order_amount)")
    .eq("is_available", true);

  const cheap: any[] = [];
  for (const l of (data || []) as any[]) {
    const opts = Array.isArray(l.pricing_options) ? l.pricing_options : [];
    for (const o of opts) {
      const price = Number(o?.price);
      if (Number.isFinite(price) && price <= 50) {
        cheap.push({
          listing_id: l.id,
          species: l.species,
          price,
          unit: o?.unit,
          bundle_size: o?.bundle_size ?? 1,
          option_id: o?.id,
          label: o?.label,
          stock: l.weight_avail,
          seller: l.seller?.name,
          seller_id: l.seller?.id,
          seller_active: l.seller?.is_active,
          hours: `${l.seller?.opens_at}-${l.seller?.closes_at}`,
          min_order: l.seller?.min_order_amount,
          pickup: l.seller?.has_pickup,
          delivery: l.seller?.has_delivery,
        });
      }
    }
  }
  cheap.sort((a, b) => a.price - b.price);
  console.log(`Found ${cheap.length} listing-options priced <= Rs 50 on PROD:\n`);
  console.log(JSON.stringify(cheap, null, 2));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
