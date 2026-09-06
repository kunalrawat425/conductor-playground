// Cleans QA test rows from buyer_waitlist. Reads creds from .env (gitignored).
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
async function main() {
  for (const [label, url, key] of [
    ["staging", process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!],
    ["prod", process.env.PROD_SUPABASE_URL!, process.env.PROD_SUPABASE_SECRET_KEY!],
  ] as const) {
    if (!url || !key) { console.log(`${label}: creds missing, skip`); continue; }
    const sb = createClient(url, key);
    const { data } = await sb.from("buyer_waitlist").select("id, phone, area").in("area", ["RLTest", "RateLimitTest"]);
    console.log(`${label}: found ${data?.length ?? 0} test rows`);
    if (data?.length) {
      await sb.from("buyer_waitlist").delete().in("area", ["RLTest", "RateLimitTest"]);
      console.log(`${label}: deleted ${data.length}`);
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
