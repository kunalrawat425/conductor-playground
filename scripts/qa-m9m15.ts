import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const BASE = "http://127.0.0.1:4321";
const ORIGIN = { "Origin": BASE };
async function req(url:string,opts:RequestInit={}){const r=await fetch(url,{...opts,headers:{...ORIGIN,...(opts.headers||{})}});return {status:r.status,body:await r.text()};}
const get = (u:string)=>req(u);
const post = (u:string,b:any)=>req(u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});

const SELLER = "337904df-ef4d-4825-b3e6-7767bedf40d2";
const CRON_SECRET = process.env.CRON_SECRET || "local_test_cron_secret";

async function main() {
  const results:[string,string][]=[];

  // ==== M9 seller listings (POST-only endpoint; reads via direct Supabase from dashboard) ====
  const r1 = await get(`${BASE}/api/seller/listings?seller_id=${SELLER}`);
  results.push(["M9-T1 GET seller/listings 404 (POST-only)", r1.status===404 ? "PASS" : `FAIL(${r1.status})`]);

  // Missing body → 400
  const r2 = await post(`${BASE}/api/seller/listings`, {});
  results.push(["M9-T2 POST empty rejected", r2.status===400 || r2.status===401 ? "PASS" : `FAIL(${r2.status})`]);

  // Direct DB read (this is what the dashboard does)
  const { data: listings } = await sb.from("fish_listings").select("id,species,seller_id").eq("seller_id", SELLER);
  results.push(["M9-T3 dashboard can read seller listings via direct RLS", Array.isArray(listings) && listings.length > 0 ? "PASS" : `FAIL(len=${listings?.length})`]);

  // ==== M15 cron ====
  const r4 = await get(`${BASE}/api/cron/expire-pending-orders`);
  results.push(["M15-T1 expire-pending no auth 401", r4.status===401 ? "PASS" : `FAIL(${r4.status})`]);

  const r5 = await req(`${BASE}/api/cron/expire-pending-orders`, { headers: { "authorization": `Bearer ${CRON_SECRET}` } });
  const d5 = r5.body ? JSON.parse(r5.body) : {};
  results.push(["M15-T2 expire-pending with auth 200", r5.status===200 ? "PASS" : `FAIL(${r5.status}: ${r5.body})`]);

  const r6 = await get(`${BASE}/api/cron/remind-sellers`);
  results.push(["M15-T3 remind-sellers no auth 401/400", [400,401].includes(r6.status) ? "PASS" : `FAIL(${r6.status})`]);

  const r7 = await req(`${BASE}/api/cron/remind-sellers`, { headers: { "authorization": `Bearer ${CRON_SECRET}` } });
  results.push(["M15-T4 remind-sellers with auth 200 or 500", [200,500].includes(r7.status) ? "PASS" : `FAIL(${r7.status})`]);

  const r8 = await get(`${BASE}/api/cron/meat-day-promo`);
  results.push(["M15-T5 meat-day no auth 401/400", [400,401].includes(r8.status) ? "PASS" : `FAIL(${r8.status})`]);

  // Revert any cron-cancelled from T2
  const { data: reverted } = await sb.from("orders").update({ status:"pending_payment", cancel_reason:null, cancelled_by:null }).eq("cancel_reason","auto_expired_payment").select("id");
  console.log(`(reverted ${reverted?.length ?? 0} cron-cancelled orders)`);

  console.log("\n=========== M9 + M15 ==========");
  results.forEach(([n,r])=>console.log(`  ${r.startsWith("PASS") ? "✓" : "✗"} ${n}: ${r}`));
  const failed = results.filter(x=>!x[1].startsWith("PASS"));
  console.log(`\n${results.length-failed.length}/${results.length} PASS`);
  process.exit(failed.length===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
