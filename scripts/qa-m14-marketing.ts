const BASE = "http://127.0.0.1:4321";
const pages = ["/", "/shop", "/about", "/for-sellers", "/terms", "/privacy", "/refund-policy", "/track", "/blog", "/preorder", "/404"];
const apis = ["/api/categories", "/sitemap.xml", "/pricing.md"];

async function main() {
  const results:[string,string,number?][]=[];
  for (const p of pages) {
    const r = await fetch(`${BASE}${p}`);
    const text = await r.text();
    const hasHtml = text.includes("</html>");
    const ok = (p === "/404" ? r.status === 404 : r.status === 200) && hasHtml;
    results.push([`page ${p}`, ok ? "PASS" : `FAIL(${r.status})`, r.status]);
  }
  for (const a of apis) {
    const r = await fetch(`${BASE}${a}`);
    results.push([`api ${a}`, r.status === 200 ? "PASS" : `FAIL(${r.status})`, r.status]);
  }
  // Waitlist join
  const wl = await fetch(`${BASE}/api/waitlist/join`, { method:"POST", headers:{"content-type":"application/json","Origin":BASE}, body: JSON.stringify({ email: "qa-test@example.com" }) });
  results.push([`api /api/waitlist/join`, [200,201,400].includes(wl.status) ? "PASS" : `FAIL(${wl.status})`, wl.status]);

  console.log("\n=========== M14 MARKETING ==========");
  results.forEach(([n,r,s])=>console.log(`  ${r.startsWith("PASS") ? "✓" : "✗"} ${n}: ${r}`));
  const failed = results.filter(x=>!x[1].startsWith("PASS"));
  console.log(`\n${results.length-failed.length}/${results.length} PASS`);
  process.exit(failed.length===0?0:1);
}
main().catch(e=>{console.error(e);process.exit(1);});
