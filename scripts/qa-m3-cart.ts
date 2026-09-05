import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const BASE = "http://127.0.0.1:4321";
const BUYER = "ceeed802-e716-40b3-bc21-bf3b92a5531c";
const LISTING_A = "2010eaf6-6dcb-4412-9370-fb24e49d9bf3"; // surmai Seller 9974
const LISTING_B = "1cf14dfc-f91c-4e6a-bc96-cb6ad1583d75"; // pomfret Seller 9974
const LISTING_C = "d3d66354-d760-470e-901d-9b277ab919ff"; // pomfret Bombay Sea Food (different seller)

const ORIGIN = { "Origin": "http://127.0.0.1:4321" };
async function req(url: string, opts: RequestInit = {}) {
  const r = await fetch(url, { ...opts, headers: { ...ORIGIN, ...(opts.headers || {}) } });
  return { status: r.status, body: await r.text() };
}

async function get(url: string) { return req(url); }
async function post(url: string, body: any) { return req(url, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(body) }); }
async function del(url: string) { return req(url, { method:"DELETE" }); }

async function cleanCart() {
  await sb.from("buyer_cart").delete().eq("buyer_id", BUYER);
}

async function main() {
  const results: [string, string][] = [];
  await cleanCart();

  // T1: empty cart returns empty items
  const r1 = await get(`${BASE}/api/buyer/cart?buyer_id=${BUYER}`);
  const d1 = JSON.parse(r1.body);
  results.push(["T1 empty cart returns []", r1.status === 200 && Array.isArray(d1.items) && d1.items.length === 0 ? "PASS" : `FAIL(${r1.status} len=${d1.items?.length})`]);

  // T2: missing buyer_id → 400
  const r2 = await get(`${BASE}/api/buyer/cart`);
  results.push(["T2 GET cart requires buyer_id", r2.status === 400 ? "PASS" : `FAIL(${r2.status})`]);

  // T3: add item
  const r3 = await post(`${BASE}/api/buyer/cart`, { buyer_id: BUYER, listing_id: LISTING_A, qty: 0.15, qty_unit: "kg", price_snapshot: 1 });
  results.push(["T3 add item", r3.status === 200 ? "PASS" : `FAIL(${r3.status}: ${r3.body})`]);

  // T4: GET now returns 1 item
  const r4 = await get(`${BASE}/api/buyer/cart?buyer_id=${BUYER}`);
  const d4 = JSON.parse(r4.body);
  results.push(["T4 cart has 1 item after add", d4.items?.length === 1 && d4.items[0].listing_id === LISTING_A ? "PASS" : `FAIL(len=${d4.items?.length})`]);

  // T5: upsert same listing → still 1 item, qty updated
  const r5 = await post(`${BASE}/api/buyer/cart`, { buyer_id: BUYER, listing_id: LISTING_A, qty: 0.30, qty_unit: "kg", price_snapshot: 2 });
  const r5g = await get(`${BASE}/api/buyer/cart?buyer_id=${BUYER}`);
  const d5 = JSON.parse(r5g.body);
  results.push(["T5 upsert updates qty (no duplicate row)", d5.items?.length === 1 && d5.items[0].qty === 0.30 ? "PASS" : `FAIL(len=${d5.items?.length} qty=${d5.items?.[0]?.qty})`]);

  // T6: qty=0 rejected
  const r6 = await post(`${BASE}/api/buyer/cart`, { buyer_id: BUYER, listing_id: LISTING_A, qty: 0, qty_unit: "kg" });
  results.push(["T6 qty=0 rejected", r6.status === 400 ? "PASS" : `FAIL(${r6.status})`]);

  // T7: qty=-1 rejected
  const r7 = await post(`${BASE}/api/buyer/cart`, { buyer_id: BUYER, listing_id: LISTING_A, qty: -1, qty_unit: "kg" });
  results.push(["T7 qty=-1 rejected", r7.status === 400 ? "PASS" : `FAIL(${r7.status})`]);

  // T8: unknown listing_id → 404
  const r8 = await post(`${BASE}/api/buyer/cart`, { buyer_id: BUYER, listing_id: "00000000-0000-0000-0000-000000000000", qty: 1, qty_unit: "kg" });
  results.push(["T8 unknown listing rejected", r8.status === 404 ? "PASS" : `FAIL(${r8.status})`]);

  // T9: multi-seller cart — allowed or blocked?
  await post(`${BASE}/api/buyer/cart`, { buyer_id: BUYER, listing_id: LISTING_C, qty: 1, qty_unit: "kg", price_snapshot: 300 });
  const r9 = await get(`${BASE}/api/buyer/cart?buyer_id=${BUYER}`);
  const d9 = JSON.parse(r9.body);
  const distinctSellers = new Set(d9.items?.map((i: any) => i.seller_id));
  results.push(["T9 multi-seller items coexist in cart (no protection)", distinctSellers.size >= 2 ? "PASS_but_BUG" : "PASS(protected)"]);

  // T10: remove single listing
  const r10 = await del(`${BASE}/api/buyer/cart?buyer_id=${BUYER}&listing_id=${LISTING_A}`);
  const r10g = await get(`${BASE}/api/buyer/cart?buyer_id=${BUYER}`);
  const d10 = JSON.parse(r10g.body);
  results.push(["T10 delete single item works", r10.status === 200 && d10.items?.length === 1 && d10.items[0].listing_id === LISTING_C ? "PASS" : `FAIL(rem=${r10.status}, remain=${d10.items?.length})`]);

  // T11: clear=true wipes cart
  await post(`${BASE}/api/buyer/cart`, { buyer_id: BUYER, listing_id: LISTING_A, qty: 0.15, qty_unit: "kg", price_snapshot: 1 });
  await post(`${BASE}/api/buyer/cart`, { buyer_id: BUYER, listing_id: LISTING_B, qty: 3, qty_unit: "piece", price_snapshot: 540 });
  const r11 = await del(`${BASE}/api/buyer/cart?buyer_id=${BUYER}&clear=true`);
  const r11g = await get(`${BASE}/api/buyer/cart?buyer_id=${BUYER}`);
  const d11 = JSON.parse(r11g.body);
  results.push(["T11 clear=true empties cart", r11.status === 200 && d11.items?.length === 0 ? "PASS" : `FAIL(rem=${d11.items?.length})`]);

  // T12: delete by seller_id
  await post(`${BASE}/api/buyer/cart`, { buyer_id: BUYER, listing_id: LISTING_A, qty: 0.15, qty_unit: "kg" });
  await post(`${BASE}/api/buyer/cart`, { buyer_id: BUYER, listing_id: LISTING_C, qty: 1, qty_unit: "kg" });
  const r12 = await del(`${BASE}/api/buyer/cart?buyer_id=${BUYER}&seller_id=337904df-ef4d-4825-b3e6-7767bedf40d2`);
  const r12g = await get(`${BASE}/api/buyer/cart?buyer_id=${BUYER}`);
  const d12 = JSON.parse(r12g.body);
  results.push(["T12 delete by seller_id removes only that seller", r12.status === 200 && d12.items?.length === 1 && d12.items[0].seller_id !== "337904df-ef4d-4825-b3e6-7767bedf40d2" ? "PASS" : `FAIL(remain=${d12.items?.length} sellers=${d12.items?.map((i:any)=>i.seller_id.slice(0,8))})`]);

  // T13: validate-cart returns listing states
  const r13 = await post(`${BASE}/api/buyer/validate-cart`, { listing_ids: [LISTING_A, LISTING_C] });
  const d13 = JSON.parse(r13.body);
  results.push(["T13 validate-cart returns listing states", r13.status === 200 && Array.isArray(d13.listings) && d13.listings.length === 2 ? "PASS" : `FAIL(${r13.status})`]);

  // T14: validate-cart with empty array → empty response, no crash
  const r14 = await post(`${BASE}/api/buyer/validate-cart`, { listing_ids: [] });
  results.push(["T14 validate-cart empty array ok", r14.status === 200 ? "PASS" : `FAIL(${r14.status})`]);

  // T15: validate-cart with fake ids → returns [] (not error)
  const r15 = await post(`${BASE}/api/buyer/validate-cart`, { listing_ids: ["00000000-0000-0000-0000-000000000000"] });
  const d15 = JSON.parse(r15.body);
  results.push(["T15 validate-cart tolerates unknown ids", r15.status === 200 && Array.isArray(d15.listings) && d15.listings.length === 0 ? "PASS" : `FAIL(${r15.status})`]);

  // T16: DELETE without any qualifier → 400
  const r16 = await del(`${BASE}/api/buyer/cart?buyer_id=${BUYER}`);
  results.push(["T16 DELETE requires qualifier", r16.status === 400 ? "PASS" : `FAIL(${r16.status})`]);

  // T17: cart-cross-buyer isolation — buyer A's cart invisible to buyer B
  const OTHER = "26989086-c65a-4d9d-8143-2959ddf23875";
  await post(`${BASE}/api/buyer/cart`, { buyer_id: BUYER, listing_id: LISTING_A, qty: 0.15, qty_unit: "kg" });
  const r17 = await get(`${BASE}/api/buyer/cart?buyer_id=${OTHER}`);
  const d17 = JSON.parse(r17.body);
  const otherHasBuyersItem = d17.items?.some((i: any) => i.listing_id === LISTING_A);
  results.push(["T17 other buyer's cart not exposed", !otherHasBuyersItem ? "PASS" : "FAIL(cross-buyer leak)"]);

  await cleanCart();

  console.log("\n=========== M3 CART ==========");
  results.forEach(([n, r]) => console.log(`  ${r.startsWith("PASS") ? "✓" : "✗"} ${n}: ${r}`));
  const failed = results.filter(x => !x[1].startsWith("PASS"));
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
