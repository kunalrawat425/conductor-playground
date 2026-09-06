/**
 * QA: payment_required (balance owed) is payable and reconcilable (BUG-47).
 *
 * The status was excluded from razorpay-create-order, razorpay-verify, the
 * webhook, and the buyer's active-orders list — so a buyer owing a balance had
 * no Pay button (the UPI fallback shows no UPI id when Razorpay is on) and the
 * order sat under "Past".
 */
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { config } from "dotenv"; config();

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const BASE = "http://127.0.0.1:4321";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => {
  if (ok) { pass++; console.log(`  ✓ ${n}: PASS`); } else { fail++; console.log(`  ✗ ${n}: FAIL ${d}`); }
};

async function seed(status: string, extra: Record<string, unknown> = {}) {
  const { data: l } = await sb.from("fish_listings").select("id, species").limit(1).single();
  const { data: b } = await sb.from("buyers").select("id, phone").limit(1).single();
  const { data: o } = await sb.from("orders").insert({
    listing_id: l!.id, species: l!.species, quantity: 1, quantity_unit: "kg",
    total_price: 500, delivery_fee: 0, buyer_id: b!.id, buyer_phone: b!.phone,
    status, order_type: "pickup", ...extra,
  }).select("id, buyer_id").single();
  return o!;
}

async function main() {
  console.log("=== A. razorpay-create-order accepts payment_required ===");
  // Buyer paid ₹500, seller priced it at ₹800 → ₹300 owed.
  const a = await seed("payment_required", { paid_amount: 500, final_price: 800 });
  const rA = await fetch(`${BASE}/api/payments/razorpay-create-order`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ order_id: a.id, buyer_id: a.buyer_id }),
  });
  const bA: any = await rA.json().catch(() => ({}));
  check("A-T1 not rejected as unpayable", rA.status !== 400 || !String(bA?.error || "").includes("cannot be paid"),
        `${rA.status} ${JSON.stringify(bA).slice(0, 140)}`);
  if (rA.status === 200) {
    // ₹300 balance, not the ₹500 total — charging the full amount again is the bug.
    check("A-T2 charges only the ₹300 balance", bA.amount === 30000, `${bA.amount} paise`);
  } else {
    console.log("    (gateway unavailable, amount not asserted):", rA.status, JSON.stringify(bA).slice(0, 120));
  }
  await sb.from("orders").delete().eq("id", a.id);

  console.log("\n=== B. webhook reconciles a balance top-up ===");
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) console.log("  ! no webhook secret — skipped");
  else {
    const rzp = `order_bal${Date.now()}`;
    const b = await seed("payment_required", { paid_amount: 500, final_price: 800, razorpay_order_id: rzp });
    const payload = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: `pay_bal${Date.now()}`, order_id: rzp, status: "captured", amount: 30000 } } },
    });
    const sig = createHmac("sha256", secret).update(payload).digest("hex");
    const r = await fetch(`${BASE}/api/payments/razorpay-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-razorpay-signature": sig, Origin: BASE },
      body: payload,
    });
    const body: any = await r.json();
    check("B-T1 webhook reconciled the row", body.reconciled === 1, JSON.stringify(body));
    const { data: after } = await sb.from("orders").select("status").eq("id", b.id).single();
    check("B-T2 order is now confirmed", after?.status === "confirmed", String(after?.status));
    await sb.from("orders").delete().eq("id", b.id);
  }

  console.log("\n=== C. buyer's active list includes in-flight statuses ===");
  const { data: buyer } = await sb.from("buyers").select("id, phone").limit(1).single();
  const made: string[] = [];
  for (const st of ["payment_required", "pre_order", "scheduled", "paid"]) {
    const o = await seed(st, st === "payment_required" ? { paid_amount: 500, final_price: 800 } : {});
    await sb.from("orders").update({ buyer_id: buyer!.id, buyer_phone: buyer!.phone }).eq("id", o.id);
    made.push(o.id);
  }
  const rc = await fetch(`${BASE}/api/buyer/orders?buyer_id=${buyer!.id}&scope=active&page_size=200`, { headers: { Origin: BASE } });
  const cb: any = await rc.json().catch(() => ({}));
  const ids: string[] = (cb.orders || []).map((o: any) => o.id);
  for (const [i, st] of ["payment_required", "pre_order", "scheduled", "paid"].entries()) {
    check(`C-T${i + 1} ${st} appears under active`, ids.includes(made[i]), "missing");
  }
  await sb.from("orders").delete().in("id", made);

  if (pass + fail === 0) { console.log("NO ASSERTIONS RAN"); process.exitCode = 1; return; }
  console.log(`\n${pass}/${pass + fail} PASS`);
  if (fail > 0) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
