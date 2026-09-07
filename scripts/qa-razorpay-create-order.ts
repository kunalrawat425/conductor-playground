/**
 * QA: /api/payments/razorpay-create-order.
 *
 * BUG-49 regression: Razorpay answers 400 BAD_REQUEST_ERROR ("The id provided
 * does not exist") for an unknown or foreign order id — a definitive answer,
 * not an outage. Treating every non-2xx as unreachable returned 502 and left
 * any row carrying a stale razorpay_order_id permanently unpayable.
 *
 * Requires a dev server on 127.0.0.1:4321 and Razorpay test keys in .env.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const BASE = "http://127.0.0.1:4321";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => {
  if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}  ${d}`); }
};

const post = (order_id: string, buyer_id: string) =>
  fetch(`${BASE}/api/payments/razorpay-create-order`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ order_id, buyer_id }),
  });

async function main() {
  const { data: l } = await sb.from("fish_listings").select("id, species").limit(1).single();
  const { data: buyer } = await sb.from("buyers").select("id, phone").limit(1).single();
  if (!l || !buyer) { console.log("! no fixtures"); process.exitCode = 1; return; }

  const made: string[] = [];
  const mk = async (extra: Record<string, unknown> = {}) => {
    const { data, error } = await sb.from("orders").insert({
      listing_id: l.id, species: l.species, quantity: 1, quantity_unit: "kg",
      total_price: 500, delivery_fee: 0, buyer_id: buyer.id, buyer_phone: buyer.phone,
      status: "pending_payment", order_type: "pickup", buyer_notes: "RZP QA — auto-deleted",
      ...extra,
    }).select("id").single();
    if (error) throw new Error(error.message);
    made.push(data!.id);
    return data!.id;
  };

  console.log("\n=== A. fresh order with no cached id ===");
  {
    const id = await mk();
    const r = await post(id, buyer.id);
    const b: any = await r.json();
    check("A-T1 returns 200", r.status === 200, `${r.status} ${JSON.stringify(b).slice(0,120)}`);
    check("A-T2 returns a razorpay_order_id", typeof b.razorpay_order_id === "string" && b.razorpay_order_id.startsWith("order_"), String(b.razorpay_order_id));
    check("A-T3 charges total_price + delivery_fee (₹500 = 50000 paise)", b.amount === 50000, String(b.amount));
    check("A-T4 persists the id on the order", !!(await sb.from("orders").select("razorpay_order_id").eq("id", id).single()).data?.razorpay_order_id);
  }

  console.log("\n=== B. BUG-49: stale id Razorpay does not recognise ===");
  {
    const id = await mk({ razorpay_order_id: "order_STALEDOESNOTEXIST" });
    const r = await post(id, buyer.id);
    const b: any = await r.json().catch(() => ({}));
    // Before the fix this was 502 "Could not reach the payment gateway" forever.
    check("B-T1 does NOT return 502", r.status !== 502, `${r.status} ${JSON.stringify(b).slice(0,140)}`);
    check("B-T2 returns 200", r.status === 200, String(r.status));
    check("B-T3 issues a DIFFERENT, real order id", typeof b.razorpay_order_id === "string" && b.razorpay_order_id !== "order_STALEDOESNOTEXIST", String(b.razorpay_order_id));
    const { data: row } = await sb.from("orders").select("razorpay_order_id").eq("id", id).single();
    check("B-T4 the stale id is replaced on the row", row?.razorpay_order_id === b.razorpay_order_id, String(row?.razorpay_order_id));
  }

  console.log("\n=== C. reuse is idempotent when the amount still matches ===");
  {
    const id = await mk();
    const first: any = await (await post(id, buyer.id)).json();
    const second: any = await (await post(id, buyer.id)).json();
    check("C-T1 second call reuses the same razorpay order", first.razorpay_order_id === second.razorpay_order_id, `${first.razorpay_order_id} vs ${second.razorpay_order_id}`);
  }

  console.log("\n=== D. amount drift replaces an unpaid cached order ===");
  {
    const id = await mk();
    const before: any = await (await post(id, buyer.id)).json();
    // Seller raises the price — the cached Razorpay order now carries a stale amount.
    await sb.from("orders").update({ total_price: 750 }).eq("id", id);
    const after: any = await (await post(id, buyer.id)).json();
    check("D-T1 issues a new razorpay order", after.razorpay_order_id !== before.razorpay_order_id, String(after.razorpay_order_id));
    check("D-T2 at the new amount (₹750 = 75000 paise)", after.amount === 75000, String(after.amount));
  }

  console.log("\n=== E. guards ===");
  {
    const id = await mk();
    const wrong = await post(id, "00000000-0000-0000-0000-000000000000");
    check("E-T1 wrong buyer_id is rejected 403", wrong.status === 403, String(wrong.status));

    const confirmed = await mk({ status: "confirmed", payment_verified_at: new Date().toISOString() });
    const r = await post(confirmed, buyer.id);
    const b: any = await r.json().catch(() => ({}));
    check("E-T2 confirmed order cannot be paid again", r.status === 400, `${r.status} ${JSON.stringify(b).slice(0,120)}`);

    const missing = await post("00000000-0000-0000-0000-000000000000", buyer.id);
    check("E-T3 unknown order returns 404", missing.status === 404, String(missing.status));
  }

  console.log("\n=== F. balance payment charges only the difference (BUG-47) ===");
  {
    const id = await mk({ status: "payment_required", paid_amount: 500, final_price: 800 });
    const r = await post(id, buyer.id);
    const b: any = await r.json().catch(() => ({}));
    check("F-T1 returns 200", r.status === 200, `${r.status} ${JSON.stringify(b).slice(0,120)}`);
    check("F-T2 charges the ₹300 balance, not ₹500", b.amount === 30000, `${b.amount} paise`);
  }

  await sb.from("orders").delete().in("id", made);
  const { data: left } = await sb.from("orders").select("id").eq("buyer_notes", "RZP QA — auto-deleted");
  check("cleanup: no QA rows left", (left?.length ?? 0) === 0, `${left?.length} left`);

  if (pass + fail === 0) { console.log("NO ASSERTIONS RAN"); process.exitCode = 1; return; }
  console.log(`\n${pass}/${pass + fail} PASS`);
  if (fail > 0) process.exitCode = 1;
}
main().catch(e => { console.error(e.message || e); process.exitCode = 1; });
