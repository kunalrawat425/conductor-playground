/**
 * QA: delivery fee is charged once per cart, not once per line (BUG-40).
 *
 * A cart splits into one order row per line, each paid separately, so a
 * per-line fee multiplies the delivery charge by the number of lines. The
 * free_delivery_above case is worse: the client compares the whole subtotal
 * and can show "FREE" while the server charges per line.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const BASE = "http://127.0.0.1:4321";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}: PASS`); }
  else { fail++; console.log(`  ✗ ${name}: FAIL ${detail}`); }
}

async function twoListings(sellerId: string) {
  const { data } = await sb.from("fish_listings")
    .select("id, species, seller_id, weight_avail, pricing_options")
    .eq("seller_id", sellerId).gt("weight_avail", 3).limit(2);
  return data && data.length === 2 ? data : null;
}

async function placeCart(sellerId: string, listings: any[], buyer: any, addrId: string | null) {
  const lines = listings.map((l) => ({ listing_id: l.id, quantity: 1, quantity_unit: "kg" }));
  const r = await fetch(`${BASE}/api/orders/create-seller-cart`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({
      seller_id: sellerId, lines, buyer_id: buyer.id, buyer_phone: buyer.phone,
      order_type: "delivery", buyer_addr: addrId,
    }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function main() {
  const { data: buyer } = await sb.from("buyers").select("id, phone").limit(1).single();
  const { data: addr } = await sb.from("buyer_addresses").select("id").eq("buyer_id", buyer!.id).limit(1).maybeSingle();

  // Find a seller with >=2 listings we can put in one cart.
  const { data: sellers } = await sb.from("sellers")
    .select("id, name, delivery_fee_enabled, delivery_fee_amount, delivery_fee_type, free_delivery_above, min_order_amount, has_delivery, opens_at, closes_at")
    .eq("has_delivery", true).limit(40);

  let target: any = null, listings: any[] | null = null;
  for (const s of sellers || []) {
    const ls = await twoListings(s.id);
    if (ls) { target = s; listings = ls; break; }
  }
  if (!target || !listings) { console.log("! no seller with 2 listings — cannot run"); return; }

  const saved = {
    delivery_fee_enabled: target.delivery_fee_enabled,
    delivery_fee_amount: target.delivery_fee_amount,
    delivery_fee_type: target.delivery_fee_type,
    free_delivery_above: target.free_delivery_above,
    min_order_amount: target.min_order_amount,
    opens_at: target.opens_at, closes_at: target.closes_at,
  };
  console.log(`seller: ${target.name} (${target.id.slice(0, 8)}), listings: ${listings.length}`);

  try {
    // ---- Case A: flat fee, 2-line cart. Total fee across rows must equal ONE fee.
    await sb.from("sellers").update({
      delivery_fee_enabled: true, delivery_fee_amount: 30, delivery_fee_type: "fixed",
      free_delivery_above: null, min_order_amount: 0,
      opens_at: "00:00:00", closes_at: "23:59:00",
    }).eq("id", target.id);

    console.log("\n=== A. Flat ₹30 fee, 2-line cart ===");
    const a = await placeCart(target.id, listings, buyer, addr?.id ?? null);
    if (a.status !== 201) {
      console.log("  ! cart rejected:", a.status, JSON.stringify(a.body).slice(0, 200));
    } else {
      const rows: any[] = a.body.orders || [];
      const fees = rows.map((o) => Number(o.delivery_fee));
      const total = fees.reduce((x, y) => x + y, 0);
      console.log(`  rows=${rows.length} fees=[${fees.join(", ")}] total=₹${total}`);
      check("A-T1 cart produced 2 order rows", rows.length === 2, String(rows.length));
      check("A-T2 total delivery charged is ONE fee (₹30)", total === 30, `₹${total}`);
      check("A-T3 exactly one row carries the fee", fees.filter((f) => f > 0).length === 1, JSON.stringify(fees));
      await sb.from("orders").delete().in("id", rows.map((o) => o.id));
    }

    // ---- Case B: free_delivery_above. Subtotal clears the threshold, so the
    // buyer was shown FREE — the server must agree and charge nothing.
    const lineTotal = 0; // discovered from the rows below
    await sb.from("sellers").update({
      delivery_fee_enabled: true, delivery_fee_amount: 40, delivery_fee_type: "fixed",
      free_delivery_above: 1, min_order_amount: 0,
    }).eq("id", target.id);

    console.log("\n=== B. free_delivery_above cleared by cart subtotal ===");
    const b = await placeCart(target.id, listings, buyer, addr?.id ?? null);
    if (b.status !== 201) {
      console.log("  ! cart rejected:", b.status, JSON.stringify(b.body).slice(0, 200));
    } else {
      const rows: any[] = b.body.orders || [];
      const fees = rows.map((o) => Number(o.delivery_fee));
      const total = fees.reduce((x, y) => x + y, 0);
      const subtotal = Number(b.body.cart_subtotal);
      console.log(`  subtotal=₹${subtotal} threshold=₹1 fees=[${fees.join(", ")}] total=₹${total}`);
      check("B-T1 subtotal clears the free-delivery threshold", subtotal >= 1, `₹${subtotal}`);
      check("B-T2 server charges ₹0, matching the FREE shown to the buyer", total === 0, `₹${total}`);
      await sb.from("orders").delete().in("id", rows.map((o) => o.id));
    }

    // ---- Case C: pickup carts must never carry a delivery fee.
    console.log("\n=== C. Pickup cart ===");
    await sb.from("sellers").update({ free_delivery_above: null, delivery_fee_amount: 30 }).eq("id", target.id);
    const lines = listings.map((l) => ({ listing_id: l.id, quantity: 1, quantity_unit: "kg" }));
    const rc = await fetch(`${BASE}/api/orders/create-seller-cart`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: BASE },
      body: JSON.stringify({ seller_id: target.id, lines, buyer_id: buyer!.id, buyer_phone: buyer!.phone, order_type: "pickup" }),
    });
    const cb: any = await rc.json().catch(() => ({}));
    if (rc.status !== 201) console.log("  ! cart rejected:", rc.status, JSON.stringify(cb).slice(0, 200));
    else {
      const rows: any[] = cb.orders || [];
      const total = rows.reduce((x, o) => x + Number(o.delivery_fee), 0);
      check("C-T1 pickup cart has no delivery fee", total === 0, `₹${total}`);
      await sb.from("orders").delete().in("id", rows.map((o) => o.id));
    }
  } finally {
    await sb.from("sellers").update(saved).eq("id", target.id);
    console.log("\nseller config restored");
  }

  console.log(`\n${pass}/${pass + fail} PASS`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
