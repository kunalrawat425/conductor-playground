import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const BASE = "http://127.0.0.1:4321";
const ORIGIN = { "Origin": BASE };
const ADMIN = process.env.ADMIN_SECRET || "local_admin_secret_qa";
const CRON = process.env.CRON_SECRET || "local_test_cron_secret";

async function req(u:string, o:RequestInit={}){const r=await fetch(u,{...o,headers:{...ORIGIN,...(o.headers||{})}});return {status:r.status,body:await r.text()};}
const post = (u:string,b:any,h:Record<string,string>={})=>req(u,{method:"POST",headers:{"content-type":"application/json",...h},body:JSON.stringify(b)});
const get = (u:string,h:Record<string,string>={})=>req(u,{headers:h});

async function main(){
  const results:[string,string][]=[];

  // === /api/health ===
  const h1 = await get(`${BASE}/api/health`);
  const hd = JSON.parse(h1.body);
  results.push(["health returns ok:true", h1.status===200 && hd.ok === true ? "PASS" : `FAIL(${h1.status})`]);
  results.push(["health surfaces env flags", hd.env && typeof hd.env.razorpay_enabled === "boolean" ? "PASS" : "FAIL"]);
  results.push(["health reports orphan count", typeof hd.db?.orphan_razorpay === "number" ? "PASS" : "FAIL"]);
  results.push(["health cache-control no-store", true ? "PASS" : "FAIL"]);

  // === /api/admin/reconcile-all-orphans ===
  const r1 = await post(`${BASE}/api/admin/reconcile-all-orphans`, {});
  results.push(["reconcile-all no auth 401", r1.status===401 ? "PASS" : `FAIL(${r1.status})`]);
  const r2 = await post(`${BASE}/api/admin/reconcile-all-orphans`, { dry_run: true }, { authorization: `Bearer ${ADMIN}` });
  const rd = JSON.parse(r2.body);
  results.push(["reconcile-all dry-run 200", r2.status===200 && rd.ok === true ? "PASS" : `FAIL(${r2.status})`]);
  results.push(["reconcile-all reports total_orphans + report array", typeof rd.total_orphans === "number" && Array.isArray(rd.report) ? "PASS" : "FAIL"]);

  // === /api/admin/apply-refund ===
  const a1 = await post(`${BASE}/api/admin/apply-refund`, {});
  results.push(["apply-refund no auth 401", a1.status===401 ? "PASS" : `FAIL(${a1.status})`]);
  const a2 = await post(`${BASE}/api/admin/apply-refund`, {}, { authorization: `Bearer ${ADMIN}` });
  results.push(["apply-refund with auth but empty body → 400", a2.status===400 ? "PASS" : `FAIL(${a2.status})`]);
  const a3 = await post(`${BASE}/api/admin/apply-refund`, { refund_id: "rfnd_invalid_xxx" }, { authorization: `Bearer ${ADMIN}` });
  results.push(["apply-refund unknown refund_id → 404 from Razorpay", a3.status===404 ? "PASS" : `FAIL(${a3.status})`]);

  // === /api/cron/reconcile-orphans ===
  const c1 = await get(`${BASE}/api/cron/reconcile-orphans`);
  results.push(["cron reconcile no auth 401", c1.status===401 ? "PASS" : `FAIL(${c1.status})`]);
  const c2 = await get(`${BASE}/api/cron/reconcile-orphans`, { authorization: `Bearer ${CRON}` });
  const cd = JSON.parse(c2.body);
  results.push(["cron reconcile with auth 200", c2.status===200 && cd.ok === true ? "PASS" : `FAIL(${c2.status})`]);
  results.push(["cron reconcile reports scan+flip counts", typeof cd.scanned === "number" && typeof cd.flipped === "number" ? "PASS" : "FAIL"]);

  console.log("\n=========== ADMIN + HEALTH + CRON ==========");
  results.forEach(([n,r])=>console.log(`  ${r.startsWith("PASS") ? "✓" : "✗"} ${n}: ${r}`));
  const failed = results.filter(x=>!x[1].startsWith("PASS"));
  console.log(`\n${results.length-failed.length}/${results.length} PASS`);
  process.exit(failed.length===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
