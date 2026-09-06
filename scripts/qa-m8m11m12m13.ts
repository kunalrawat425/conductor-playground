import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const BASE = "http://127.0.0.1:4321";
const ORIGIN = { "Origin": BASE };
async function req(u:string,o:RequestInit={}){const r=await fetch(u,{...o,headers:{...ORIGIN,...(o.headers||{})}});return {status:r.status,body:await r.text()};}
const get = (u:string)=>req(u);
const post = (u:string,b:any)=>req(u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});

const BUYER = "ceeed802-e716-40b3-bc21-bf3b92a5531c";
const SELLER = "337904df-ef4d-4825-b3e6-7767bedf40d2";
const LISTING_PREORDER = "1cf14dfc-f91c-4e6a-bc96-cb6ad1583d75"; // pomfret bundle_size=3, preorder-enabled
const NEW_SELLER_PHONE = "+919000000001";

async function cleanup() {
  // Verify-otp for sellers strips both + and 91 → 10-digit phone stored
  await sb.from("sellers").delete().in("phone", [NEW_SELLER_PHONE, NEW_SELLER_PHONE.slice(1), NEW_SELLER_PHONE.slice(3)]);
  await sb.from("buyers").update({ push_subscription: null, push_enabled: false }).eq("id", BUYER);
  await sb.from("orders").delete().eq("buyer_phone", "+919111111111");
}

async function main() {
  const results: [string, string][] = [];
  await cleanup();

  // ==== M8 seller onboarding ====
  // T1 pages render
  const p1 = await get(`${BASE}/for-sellers`);
  results.push(["M8-T1 /for-sellers 200", p1.status===200 && p1.body.includes("</html>") ? "PASS" : `FAIL(${p1.status})`]);

  const p2 = await get(`${BASE}/dashboard/login`);
  results.push(["M8-T2 /dashboard/login 200", p2.status===200 ? "PASS" : `FAIL(${p2.status})`]);

  const p3 = await get(`${BASE}/dashboard/pending`);
  results.push(["M8-T3 /dashboard/pending 200", p3.status===200 ? "PASS" : `FAIL(${p3.status})`]);

  const p4 = await get(`${BASE}/dashboard/profile`);
  results.push(["M8-T4 /dashboard/profile 200", p4.status===200 ? "PASS" : `FAIL(${p4.status})`]);

  // T5 seller OTP with dev fallback creates seller row
  const s5 = await post(`${BASE}/api/auth/verify-otp`, { phone: NEW_SELLER_PHONE, code: "123456", role: "seller" });
  const d5 = JSON.parse(s5.body);
  results.push(["M8-T5 seller OTP creates seller_id", s5.status===200 && !!d5.seller_id ? "PASS" : `FAIL(${s5.status}: ${s5.body.slice(0,150)})`]);

  // T6 new seller stored with 10-digit phone (verify-otp strips +91 prefix)
  const bare = NEW_SELLER_PHONE.slice(3); // "9000000001"
  const { data: newSeller } = await sb.from("sellers").select("id, is_active").eq("phone", bare).maybeSingle();
  results.push(["M8-T6 new seller inactive by default", newSeller && newSeller.is_active === false ? "PASS" : `FAIL(is_active=${newSeller?.is_active})`]);

  // T7 seller/profile POST update
  const idToUpdate = newSeller?.id;
  if (idToUpdate) {
    const s7 = await post(`${BASE}/api/seller/profile`, { seller_id: idToUpdate, seller_phone: NEW_SELLER_PHONE.slice(3), updates: { name: "QA Test Seller", location_name: "Powai", lat: 19.12, lng: 72.90 } });
    results.push(["M8-T7 seller profile POST", [200, 201].includes(s7.status) ? "PASS" : `FAIL(${s7.status}: ${s7.body.slice(0,150)})`]);
  } else {
    results.push(["M8-T7 seller profile POST", "SKIP (no seller_id from T5)"]);
  }

  // ==== M11 Preorders ====
  // T1 GET /api/preorders?buyer_id=... — endpoint requires identifier
  const pr1 = await get(`${BASE}/api/preorders?buyer_id=${BUYER}`);
  results.push(["M11-T1 /api/preorders with buyer_id 200", pr1.status===200 ? "PASS" : `FAIL(${pr1.status}: ${pr1.body.slice(0,100)})`]);

  const pr1b = await get(`${BASE}/api/preorders`);
  results.push(["M11-T1b /api/preorders w/o auth rejected", pr1b.status===400 || pr1b.status===401 ? "PASS" : `FAIL(${pr1b.status})`]);

  // T2 create preorder via /api/orders/create with is_preorder_enabled listing
  const pr2 = await post(`${BASE}/api/orders/create`, {
    buyer_id: BUYER, buyer_phone: "+919111111111", listing_id: LISTING_PREORDER,
    quantity: 3, quantity_unit: "piece", order_type: "pickup",
  });
  const pd2 = JSON.parse(pr2.body);
  results.push(["M11-T2 preorder-enabled listing creates order", pr2.status===201 && !!pd2.order?.id ? "PASS" : `FAIL(${pr2.status}: ${pr2.body.slice(0,150)})`]);

  // ==== M12 Push ====
  // T1 subscribe endpoint
  const fakeSub = { endpoint: "https://fcm.googleapis.com/fcm/send/qa-test-" + Date.now(), keys: { p256dh: "TEST_KEY", auth: "TEST_AUTH" } };
  const push1 = await post(`${BASE}/api/buyer/push-subscribe`, { buyer_id: BUYER, subscription: fakeSub });
  results.push(["M12-T1 push subscribe 200", [200, 201].includes(push1.status) ? "PASS" : `FAIL(${push1.status}: ${push1.body.slice(0,150)})`]);

  // T2 subscription stored on buyers.push_subscription JSONB (not a separate table)
  const { data: b } = await sb.from("buyers").select("push_subscription, push_enabled").eq("id", BUYER).single();
  const storedEp = (b?.push_subscription as any)?.endpoint;
  results.push(["M12-T2 buyers.push_subscription set", b?.push_enabled === true && storedEp === fakeSub.endpoint ? "PASS" : `FAIL(enabled=${b?.push_enabled} ep=${storedEp})`]);

  // T3 subscribe with missing buyer_id → 400
  const push3 = await post(`${BASE}/api/buyer/push-subscribe`, { subscription: fakeSub });
  results.push(["M12-T3 missing buyer_id rejected", push3.status === 400 ? "PASS" : `FAIL(${push3.status})`]);

  // T4 subscribe with no `subscription` — 200 with unsubscribe semantics (per code comment)
  const push4 = await post(`${BASE}/api/buyer/push-subscribe`, { buyer_id: BUYER });
  const { data: b4 } = await sb.from("buyers").select("push_enabled, push_subscription").eq("id", BUYER).single();
  results.push(["M12-T4 no subscription → unsubscribes (push_enabled=false)", push4.status === 200 && b4?.push_enabled === false && b4?.push_subscription === null ? "PASS" : `FAIL(${push4.status} enabled=${b4?.push_enabled})`]);

  // ==== M13 Geo / addresses without lat/lng ====
  // T1 create address WITHOUT lat/lng — stored as null (not required)
  const g1 = await post(`${BASE}/api/buyer/addresses`, { buyer_id: BUYER, address: { label: "no-geo", flat: "X", building: "Y", location_name: "manual" } });
  const gd1 = JSON.parse(g1.body);
  const addrId = gd1.address?.id;
  results.push(["M13-T1 address WITHOUT lat/lng accepted", [200,201].includes(g1.status) && !!addrId ? "PASS" : `FAIL(${g1.status})`]);

  // T2 stored lat/lng are null
  const { data: addr } = await sb.from("buyer_addresses").select("lat,lng").eq("id", addrId).single();
  results.push(["M13-T2 lat/lng null in DB when omitted", addr && addr.lat === null && addr.lng === null ? "PASS" : `FAIL(lat=${addr?.lat} lng=${addr?.lng})`]);

  // T3 create with lat/lng
  const g3 = await post(`${BASE}/api/buyer/addresses`, { buyer_id: BUYER, address: { label: "with-geo", location_name: "GPS", lat: 19.5, lng: 72.5 } });
  const gd3 = JSON.parse(g3.body);
  results.push(["M13-T3 address WITH lat/lng accepted", [200,201].includes(g3.status) && !!gd3.address?.id ? "PASS" : `FAIL(${g3.status})`]);

  // T4 boundary lat=91 (invalid) — is server sanitising?
  const g4 = await post(`${BASE}/api/buyer/addresses`, { buyer_id: BUYER, address: { label: "bad-lat", lat: 999, lng: 999 } });
  results.push(["M13-T4 out-of-range coords: 200 or 400 (either OK, note behaviour)", [200,201,400].includes(g4.status) ? "PASS" : `FAIL(${g4.status})`]);

  // Cleanup addresses
  await sb.from("buyer_addresses").delete().eq("buyer_id", BUYER);
  await cleanup();

  console.log("\n=========== M8 + M11 + M12 + M13 ==========");
  results.forEach(([n,r])=>console.log(`  ${r.startsWith("PASS") ? "✓" : "✗"} ${n}: ${r}`));
  const failed = results.filter(x => !x[1].startsWith("PASS"));
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length===0?0:1);
}
main().catch(e => { console.error(e); process.exit(1); });
