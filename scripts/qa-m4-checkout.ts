import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const BASE = "http://127.0.0.1:4321";
const BUYER = "ceeed802-e716-40b3-bc21-bf3b92a5531c";

// Seller 9974 is open till 03:00 (test time is 22:30 IST). Their surmai listing.
const LISTING_PICKUP = "2010eaf6-6dcb-4412-9370-fb24e49d9bf3";
const SELLER = "337904df-ef4d-4825-b3e6-7767bedf40d2";

async function post(url:string, body:any) {
  const r = await fetch(url, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(body) });
  return { status: r.status, body: await r.text() };
}

async function cleanupOrder(orderId: string) {
  if (!orderId) return;
  await sb.from("orders").delete().eq("id", orderId);
}

async function main() {
  const results: [string, string, string?][] = [];
  const createdOrderIds: string[] = [];

  // T1: minimal valid same-day pickup order
  const r1 = await post(`${BASE}/api/orders/create`, {
    buyer_id: BUYER, buyer_phone: "+919359181071", listing_id: LISTING_PICKUP,
    quantity: 0.15, quantity_unit: "kg", order_type: "pickup",
  });
  const d1 = JSON.parse(r1.body);
  console.log("T1 same-day pickup:", r1.status, d1.order?.id, d1.order?.status);
  if (d1.order?.id) createdOrderIds.push(d1.order.id);
  results.push(["T1 minimal same-day pickup", r1.status === 201 && d1.order?.status === "pending_payment" ? "PASS" : `FAIL(${r1.status})`, d1.order?.id]);

  // T2: missing phone → 400
  const r2 = await post(`${BASE}/api/orders/create`, { buyer_id: BUYER, listing_id: LISTING_PICKUP, quantity: 0.15, quantity_unit: "kg" });
  console.log("T2 missing phone:", r2.status, r2.body);
  results.push(["T2 rejects missing phone", r2.status === 400 ? "PASS" : `FAIL(${r2.status})`]);

  // T3: invalid quantity
  const r3 = await post(`${BASE}/api/orders/create`, { buyer_id: BUYER, buyer_phone: "+919359181071", listing_id: LISTING_PICKUP, quantity: -1, quantity_unit: "kg" });
  console.log("T3 negative qty:", r3.status, r3.body);
  results.push(["T3 rejects negative quantity", r3.status === 400 ? "PASS" : `FAIL(${r3.status})`]);

  // T4: zero quantity
  const r4 = await post(`${BASE}/api/orders/create`, { buyer_id: BUYER, buyer_phone: "+919359181071", listing_id: LISTING_PICKUP, quantity: 0, quantity_unit: "kg" });
  console.log("T4 zero qty:", r4.status, r4.body);
  results.push(["T4 rejects zero quantity", r4.status === 400 ? "PASS" : `FAIL(${r4.status})`]);

  // T5: unknown listing_id
  const r5 = await post(`${BASE}/api/orders/create`, { buyer_id: BUYER, buyer_phone: "+919359181071", listing_id: "00000000-0000-0000-0000-000000000000", quantity: 0.15, quantity_unit: "kg" });
  console.log("T5 unknown listing:", r5.status, r5.body);
  results.push(["T5 rejects unknown listing", r5.status >= 400 ? "PASS" : `FAIL(${r5.status})`]);

  // T6: no listing_id + no species → 400
  const r6 = await post(`${BASE}/api/orders/create`, { buyer_id: BUYER, buyer_phone: "+919359181071", quantity: 0.15, quantity_unit: "kg" });
  console.log("T6 no listing/species:", r6.status, r6.body);
  results.push(["T6 rejects when no listing and no species", r6.status === 400 ? "PASS" : `FAIL(${r6.status})`]);

  // T7: delivery order without buyer_addr
  const r7 = await post(`${BASE}/api/orders/create`, { buyer_id: BUYER, buyer_phone: "+919359181071", listing_id: LISTING_PICKUP, quantity: 0.15, quantity_unit: "kg", order_type: "delivery" });
  const d7 = JSON.parse(r7.body);
  console.log("T7 delivery no addr:", r7.status, d7);
  if (d7.order?.id) createdOrderIds.push(d7.order.id);
  results.push(["T7 delivery without buyer_addr — accepted or blocked?", r7.status === 400 || r7.status === 201 ? "PASS" : `FAIL(${r7.status})`, d7.order?.id]);

  // T8: race — two identical concurrent POSTs — expect atomic RPC to serialize
  const [rA, rB] = await Promise.all([
    post(`${BASE}/api/orders/create`, { buyer_id: BUYER, buyer_phone: "+919359181071", listing_id: LISTING_PICKUP, quantity: 0.15, quantity_unit: "kg", order_type: "pickup" }),
    post(`${BASE}/api/orders/create`, { buyer_id: BUYER, buyer_phone: "+919359181071", listing_id: LISTING_PICKUP, quantity: 0.15, quantity_unit: "kg", order_type: "pickup" }),
  ]);
  const dA = JSON.parse(rA.body); const dB = JSON.parse(rB.body);
  const bothCreated = dA.order?.id && dB.order?.id && dA.order.id !== dB.order.id;
  console.log("T8 concurrent:", rA.status, rB.status, "sameOrder:", dA.order?.id === dB.order?.id);
  if (dA.order?.id) createdOrderIds.push(dA.order.id);
  if (dB.order?.id) createdOrderIds.push(dB.order.id);
  results.push(["T8 concurrent creates → distinct rows", bothCreated ? "PASS" : `FAIL(same id ${dA.order?.id})`]);

  // T9: very long buyer_notes (SQL injection / truncation check)
  const injection = "'; DROP TABLE orders; -- " + "x".repeat(2000);
  const r9 = await post(`${BASE}/api/orders/create`, { buyer_id: BUYER, buyer_phone: "+919359181071", listing_id: LISTING_PICKUP, quantity: 0.15, quantity_unit: "kg", buyer_notes: injection });
  const d9 = JSON.parse(r9.body);
  console.log("T9 long notes:", r9.status, "notes len stored:", d9.order?.buyer_notes?.length);
  if (d9.order?.id) createdOrderIds.push(d9.order.id);
  const notesOk = r9.status === 201 && d9.order?.buyer_notes && d9.order.buyer_notes.length <= 500;
  results.push(["T9 buyer_notes truncated ≤500 chars", notesOk ? "PASS" : `FAIL(len=${d9.order?.buyer_notes?.length})`]);

  // T10: extremely large quantity (integer overflow check)
  const r10 = await post(`${BASE}/api/orders/create`, { buyer_id: BUYER, buyer_phone: "+919359181071", listing_id: LISTING_PICKUP, quantity: 1e12, quantity_unit: "kg" });
  console.log("T10 huge qty:", r10.status, r10.body.slice(0,150));
  results.push(["T10 huge quantity rejected or capped", r10.status >= 400 ? "PASS" : `FAIL(accepted ${r10.status})`]);

  // Cleanup
  console.log("\ncleanup:", createdOrderIds.length, "orders");
  for (const id of createdOrderIds) await cleanupOrder(id);

  console.log("\n=========== M4 CHECKOUT ==========");
  results.forEach(([n, r, id]) => console.log(`  ${r === "PASS" ? "✓" : "✗"} ${n}: ${r}${id ? " ["+id.slice(0,8)+"]" : ""}`));
  const failed = results.filter(x => x[1] !== "PASS");
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
