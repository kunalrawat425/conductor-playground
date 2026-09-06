/**
 * QA: seller-level gates apply during the pre-order window too (BUG-46).
 *
 * The pre-order branch of /api/orders/create returned 201 before the block that
 * enforces min_order_amount / has_delivery / has_pickup, and hard-coded
 * delivery_fee to 0.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const BASE = "http://127.0.0.1:4321";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => {
  if (ok) { pass++; console.log(`  ✓ ${n}: PASS`); } else { fail++; console.log(`  ✗ ${n}: FAIL ${d}`); }
};

async function main() {
  const { data: l } = await sb.from("fish_listings")
    .select("id, species, seller_id, pricing_options, weight_avail")
    .eq("is_preorder_enabled", true).gt("weight_avail", 5).limit(1).maybeSingle();
  if (!l) { console.log("! no pre-order listing — cannot run"); process.exitCode = 1; return; }

  const { data: seller } = await sb.from("sellers")
    .select("id, name, has_delivery, has_pickup, min_order_amount, accepts_preorder, preorder_days, opens_at, closes_at, open_days, preorder_cutoff_time, delivery_fee_enabled, delivery_fee_amount, delivery_fee_type, free_delivery_above")
    .eq("id", l.seller_id).single();
  const { data: buyer } = await sb.from("buyers").select("id, phone").limit(1).single();
  if (!seller || !buyer) { console.log("! missing fixtures"); process.exitCode = 1; return; }

  const saved: any = { ...seller };
  delete saved.id; delete saved.name;

  // Smallest legal pack for this listing.
  const opts: any[] = Array.isArray(l.pricing_options) ? l.pricing_options : [];
  const bundle = Number(opts[0]?.bundle_size) > 0 ? Number(opts[0].bundle_size) : 1;
  const unit = opts[0]?.unit === "piece" ? "piece" : "kg";

  const place = async (order_type: string) => {
    const r = await fetch(`${BASE}/api/orders/create`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({
        listing_id: l.id, quantity: bundle, quantity_unit: unit,
        buyer_id: buyer.id, buyer_phone: buyer.phone, order_type,
      }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  // Put the seller into the pre-order shopping window: closed now, accepts
  // pre-orders, cutoff not yet passed.
  const openWindow = {
    accepts_preorder: true, preorder_days: [], open_days: [],
    opens_at: "00:00:00", closes_at: "00:01:00", preorder_cutoff_time: "23:59:00",
  };

  try {
    console.log("\n=== A. min_order_amount enforced during pre-order ===");
    await sb.from("sellers").update({ ...openWindow, has_delivery: true, has_pickup: true, min_order_amount: 999999 }).eq("id", seller.id);
    const a = await place("pickup");
    check("A-T1 rejected below minimum", a.status === 400, `${a.status} ${JSON.stringify(a.body).slice(0, 120)}`);
    check("A-T2 error names the minimum", String((a.body as any)?.error || "").includes("Minimum order"), JSON.stringify(a.body).slice(0, 120));

    console.log("\n=== B. has_delivery enforced during pre-order ===");
    await sb.from("sellers").update({ ...openWindow, has_delivery: false, has_pickup: true, min_order_amount: 0 }).eq("id", seller.id);
    const b = await place("delivery");
    check("B-T1 delivery rejected when seller does not deliver", b.status === 400, `${b.status} ${JSON.stringify(b.body).slice(0, 120)}`);
    check("B-T2 error says so", String((b.body as any)?.error || "").includes("does not offer delivery"), JSON.stringify(b.body).slice(0, 120));

    console.log("\n=== C. has_pickup enforced during pre-order ===");
    await sb.from("sellers").update({ ...openWindow, has_delivery: true, has_pickup: false, min_order_amount: 0 }).eq("id", seller.id);
    const c = await place("pickup");
    check("C-T1 pickup rejected when seller does not offer pickup", c.status === 400, `${c.status} ${JSON.stringify(c.body).slice(0, 120)}`);

    console.log("\n=== D. a legitimate pre-order still succeeds ===");
    await sb.from("sellers").update({ ...openWindow, has_delivery: true, has_pickup: true, min_order_amount: 0, delivery_fee_enabled: false }).eq("id", seller.id);
    const d = await place("pickup");
    check("D-T1 accepted", d.status === 201, `${d.status} ${JSON.stringify(d.body).slice(0, 160)}`);
    if (d.status === 201) {
      const o = (d.body as any).order;
      check("D-T2 marked as a pre-order", (d.body as any).placement_kind === "preorder", String((d.body as any).placement_kind));
      await sb.from("orders").delete().eq("id", o.id);
    }

    console.log("\n=== E. delivery fee is charged on pre-orders, not hard-coded 0 ===");
    await sb.from("sellers").update({
      ...openWindow, has_delivery: true, has_pickup: true, min_order_amount: 0,
      delivery_fee_enabled: true, delivery_fee_amount: 25, delivery_fee_type: "fixed", free_delivery_above: null,
    }).eq("id", seller.id);
    const e = await place("delivery");
    if (e.status !== 201) console.log("  ! rejected:", e.status, JSON.stringify(e.body).slice(0, 160));
    else {
      const o = (e.body as any).order;
      check("E-T1 pre-order carries the seller's delivery fee", Number(o.delivery_fee) === 25, `₹${o.delivery_fee}`);
      await sb.from("orders").delete().eq("id", o.id);
    }
  } finally {
    await sb.from("sellers").update(saved).eq("id", seller.id);
    console.log("\nseller config restored");
  }

  if (pass + fail === 0) { console.log("NO ASSERTIONS RAN"); process.exitCode = 1; return; }
  console.log(`\n${pass}/${pass + fail} PASS`);
  if (fail > 0) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
