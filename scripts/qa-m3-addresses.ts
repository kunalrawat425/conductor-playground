import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const BASE = "http://127.0.0.1:4321";
const BUYER = "ceeed802-e716-40b3-bc21-bf3b92a5531c";
const ORIGIN = { "Origin": "http://127.0.0.1:4321" };

async function req(url:string, opts:RequestInit={}) {
  const r = await fetch(url, { ...opts, headers:{ ...ORIGIN, ...(opts.headers||{}) } });
  return { status: r.status, body: await r.text() };
}
async function get(url:string){return req(url);}
async function post(url:string,body:any){return req(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});}
async function put(url:string,body:any){return req(url,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(body)});}
async function del(url:string){return req(url,{method:"DELETE"});}

async function cleanup() {
  await sb.from("buyer_addresses").delete().eq("buyer_id", BUYER);
}

async function main(){
  const results:[string,string][]=[];
  await cleanup();
  const created:string[]=[];

  // T1 empty list
  const r1 = await get(`${BASE}/api/buyer/addresses?buyer_id=${BUYER}`);
  const d1 = JSON.parse(r1.body);
  results.push(["T1 empty list", r1.status===200 && Array.isArray(d1.addresses) && d1.addresses.length===0 ? "PASS" : `FAIL(${r1.status})`]);

  // T2 create address
  const r2 = await post(`${BASE}/api/buyer/addresses`, { buyer_id: BUYER, address: { label: "Home", flat: "A-101", building: "Test Bldg", location_name: "Powai", lat: 19.12, lng: 72.90, is_default: true } });
  const d2 = JSON.parse(r2.body);
  if (d2.address?.id) created.push(d2.address.id);
  results.push(["T2 create address returns id", (r2.status===200||r2.status===201) && !!d2.address?.id ? "PASS" : `FAIL(${r2.status}: ${r2.body.slice(0,150)})`]);

  // T3 list has 1
  const r3 = await get(`${BASE}/api/buyer/addresses?buyer_id=${BUYER}`);
  const d3 = JSON.parse(r3.body);
  results.push(["T3 list has 1 default address", d3.addresses?.length===1 && d3.addresses[0].is_default===true ? "PASS" : `FAIL(len=${d3.addresses?.length})`]);

  // T4 missing buyer_id
  const r4 = await get(`${BASE}/api/buyer/addresses`);
  results.push(["T4 GET requires buyer_id", r4.status===400 ? "PASS" : `FAIL(${r4.status})`]);

  // T5 missing address obj
  const r5 = await post(`${BASE}/api/buyer/addresses`, { buyer_id: BUYER });
  results.push(["T5 POST requires address obj", r5.status===400 ? "PASS" : `FAIL(${r5.status})`]);

  // T6 second address takes over default
  const r6 = await post(`${BASE}/api/buyer/addresses`, { buyer_id: BUYER, address: { label: "Office", flat: "B-201", location_name: "BKC", lat: 19.06, lng: 72.87, is_default: true } });
  const d6 = JSON.parse(r6.body);
  if (d6.address?.id) created.push(d6.address.id);
  const r6g = await get(`${BASE}/api/buyer/addresses?buyer_id=${BUYER}`);
  const d6g = JSON.parse(r6g.body);
  const defaults = d6g.addresses.filter((a:any)=>a.is_default===true);
  results.push(["T6 new default demotes old", defaults.length===1 && defaults[0].label==="Office" ? "PASS" : `FAIL(defaults=${defaults.length} label=${defaults[0]?.label})`]);

  // T7 cross-buyer isolation
  const OTHER = "26989086-c65a-4d9d-8143-2959ddf23875";
  const r7 = await get(`${BASE}/api/buyer/addresses?buyer_id=${OTHER}`);
  const d7 = JSON.parse(r7.body);
  const leaked = d7.addresses?.some((a:any)=>created.includes(a.id));
  results.push(["T7 no cross-buyer leak", !leaked ? "PASS" : "FAIL(leak)"]);

  // T8 delete address (DELETE uses JSON body, unlike cart which uses query params — inconsistency noted)
  if (created[0]) {
    const r8 = await req(`${BASE}/api/buyer/addresses`, { method:"DELETE", headers:{"content-type":"application/json"}, body: JSON.stringify({ buyer_id: BUYER, id: created[0] }) });
    results.push(["T8 delete first address", r8.status===200 ? "PASS" : `FAIL(${r8.status}: ${r8.body})`]);
  }

  // T9 injection / oversize
  const r9 = await post(`${BASE}/api/buyer/addresses`, { buyer_id: BUYER, address: { label: "Home", flat: "'; DROP TABLE buyer_addresses; --", building: "X".repeat(5000), location_name: "test" } });
  const d9 = JSON.parse(r9.body);
  if (d9.address?.id) created.push(d9.address.id);
  results.push(["T9 injection payload stored safely (no crash)", (r9.status===200||r9.status===201) && !!d9.address?.id ? "PASS" : `FAIL(${r9.status})`]);

  // T10 verify table still exists (DROP attempt)
  const { data: still } = await sb.from("buyer_addresses").select("id").limit(1);
  results.push(["T10 table not dropped", Array.isArray(still) ? "PASS" : "FAIL(table gone?)"]);

  await cleanup();

  console.log("\n=========== M3 ADDRESSES ==========");
  results.forEach(([n,r])=>console.log(`  ${r.startsWith("PASS") ? "✓" : "✗"} ${n}: ${r}`));
  const failed = results.filter(x=>!x[1].startsWith("PASS"));
  console.log(`\n${results.length-failed.length}/${results.length} PASS`);
  process.exit(failed.length===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
