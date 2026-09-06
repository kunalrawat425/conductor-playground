const BASE = "http://127.0.0.1:4321";
async function get(url:string){const r=await fetch(url);return {status:r.status,body:await r.text()};}

async function main() {
  const results:[string,string][]=[];

  // T1 /shop returns 200 + HTML
  const r1 = await get(`${BASE}/shop`);
  results.push(["T1 /shop 200 HTML", r1.status===200 && r1.body.includes("</html>") ? "PASS" : `FAIL(${r1.status})`]);

  // T2 /api/search returns JSON with listings
  const r2 = await get(`${BASE}/api/search?q=fish`);
  const d2 = JSON.parse(r2.body);
  results.push(["T2 /api/search returns listings", r2.status===200 && Array.isArray(d2.listings) && d2.listings.length > 0 ? "PASS" : `FAIL(${r2.status} len=${d2.listings?.length})`]);

  // T3 /api/search empty query → all listings
  const r3 = await get(`${BASE}/api/search`);
  const d3 = JSON.parse(r3.body);
  results.push(["T3 /api/search no query returns listings", r3.status===200 && Array.isArray(d3.listings) ? "PASS" : `FAIL(${r3.status})`]);

  // T4 /api/search with SQL injection in q
  const r4 = await get(`${BASE}/api/search?q=%27%20OR%201%3D1--`);
  const d4 = JSON.parse(r4.body);
  results.push(["T4 /api/search injection safe", r4.status===200 && Array.isArray(d4.listings) ? "PASS" : `FAIL(${r4.status})`]);

  // T5 /api/search with unicode + emoji
  const r5 = await get(`${BASE}/api/search?q=${encodeURIComponent("सुरमई🐟")}`);
  results.push(["T5 unicode/emoji q handled", r5.status===200 ? "PASS" : `FAIL(${r5.status})`]);

  // T6 /api/search returns pricing_options for bundle listings
  const items = (d2.listings || []) as any[];
  const withBundle = items.find(i => Array.isArray(i.pricing_options) && i.pricing_options.some((p:any) => Number(p.bundle_size) > 1));
  results.push(["T6 pricing_options with bundle_size present", withBundle ? "PASS" : "FAIL(no bundle listing found)"]);

  // T7 /api/sellers/nearby without lat/lng
  const r7 = await get(`${BASE}/api/sellers/nearby`);
  results.push(["T7 /api/sellers/nearby no coords: 200 or 400", [200, 400].includes(r7.status) ? "PASS" : `FAIL(${r7.status})`]);

  // T8 /api/sellers/nearby with coords
  const r8 = await get(`${BASE}/api/sellers/nearby?lat=19.12&lng=72.90`);
  results.push(["T8 /api/sellers/nearby with coords 200", r8.status===200 ? "PASS" : `FAIL(${r8.status})`]);

  // T9 /api/categories 200
  const r9 = await get(`${BASE}/api/categories`);
  results.push(["T9 /api/categories 200", r9.status===200 ? "PASS" : `FAIL(${r9.status})`]);

  // T10 /s/<slug> renders (seller page)
  const r10 = await get(`${BASE}/s/seller-9974`);
  results.push(["T10 /s/seller-9974 200", r10.status===200 && r10.body.includes("</html>") ? "PASS" : `FAIL(${r10.status})`]);

  // T11 /s/<unknown-slug> — should 404 or graceful
  const r11 = await get(`${BASE}/s/nonexistent-seller-slug-xyz`);
  results.push(["T11 /s/<unknown> handled (404 or graceful)", [200,404].includes(r11.status) ? "PASS" : `FAIL(${r11.status})`]);

  // T12 /search page renders
  const r12 = await get(`${BASE}/search`);
  results.push(["T12 /search 200", r12.status===200 ? "PASS" : `FAIL(${r12.status})`]);

  // T13 /area/mumbai renders
  const r13 = await get(`${BASE}/area/mumbai`);
  results.push(["T13 /area/mumbai 200 or 404", [200,404].includes(r13.status) ? "PASS" : `FAIL(${r13.status})`]);

  // T14 sitemap
  const r14 = await get(`${BASE}/sitemap.xml`);
  results.push(["T14 sitemap.xml 200 XML", r14.status===200 && r14.body.includes("<urlset") ? "PASS" : `FAIL(${r14.status})`]);

  console.log("\n=========== M2 BROWSE ==========");
  results.forEach(([n,r])=>console.log(`  ${r.startsWith("PASS") ? "✓" : "✗"} ${n}: ${r}`));
  const failed = results.filter(x=>!x[1].startsWith("PASS"));
  console.log(`\n${results.length-failed.length}/${results.length} PASS`);
  process.exit(failed.length===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
