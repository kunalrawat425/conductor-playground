/**
 * Command-line utility to send a direct FCM Web Push notification to any registered buyer.
 * 
 * Usage:
 *   npx tsx scripts/send-push.ts --phone <phone> --title "<title>" --body "<body>" [--path "/shop"]
 * 
 * Example:
 *   npx tsx scripts/send-push.ts --phone 9876543210 --title "Fresh Catch Alert" --body "Check live fish rates near you!"
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Robust manual parser for .env.local to load credentials into process.env
function loadEnv() {
  try {
    const envPath = path.join(__dirname, "..", ".env.local");
    if (!fs.existsSync(envPath)) {
      console.error("❌ Could not find .env.local file. Please run from the project root.");
      process.exit(1);
    }
    const content = fs.readFileSync(envPath, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || "";
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        process.env[key] = value.trim();
      }
    }
  } catch (err: any) {
    console.error("❌ Error loading .env.local:", err.message);
  }
}

// 1. Load env parameters first so that module-level imports of getPushConfig resolve process.env variables
loadEnv();

// Now import dependencies after env variables are populated
import { createClient } from "@supabase/supabase-js";
import { sendCustomBuyerPush } from "../src/lib/server/buyer-push";

async function main() {
  // Parse simple CLI arguments
  const args = process.argv.slice(2);
  const params: Record<string, string> = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const val = args[i + 1];
      if (val && !val.startsWith("--")) {
        params[key] = val;
        i++;
      }
    }
  }

  const phone = params.phone;
  const title = params.title || "Relifish Update";
  const body = params.body || "Hello, you have a new notification!";
  const urlPath = params.path || "/shop";

  if (!phone) {
    console.error(`
❌ Missing required argument: --phone

Usage:
  npx tsx scripts/send-push.ts --phone <phone> --title "<title>" --body "<body>" [--path "<url_path>"]

Example:
  npx tsx scripts/send-push.ts --phone 9876543210 --title "Fresh Catch Alert" --body "Check live fish rates!"
`);
    process.exit(1);
  }

  const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("❌ Missing Supabase credentials. Ensure PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY are in .env.local.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const formattedPhone = phone.replace(/[^0-9]/g, "");

  console.log(`🔍 Looking up buyer with phone like "%${formattedPhone}"...`);
  
  const { data: buyer, error } = await supabase
    .from("buyers")
    .select("id, first_name, last_name, phone, push_subscription, push_enabled")
    .ilike("phone", `%${formattedPhone}%`)
    .maybeSingle();

  if (error) {
    console.error("❌ Database lookup failed:", error.message);
    process.exit(1);
  }

  if (!buyer) {
    console.error(`❌ No buyer found with phone containing "${formattedPhone}". Please verify their number is registered.`);
    process.exit(1);
  }

  console.log(`✅ Found Buyer: ${buyer.first_name || ""} ${buyer.last_name || ""} (${buyer.phone})`);
  
  if (!buyer.push_subscription) {
    console.error(`❌ This buyer has not enabled push alerts. Ask them to visit /me and toggle "Alerts".`);
    process.exit(1);
  }

  console.log("🚀 Sending FCM push notification via VAPID service...");
  
  const result = await sendCustomBuyerPush(
    buyer.id,
    { title, body },
    urlPath
  );

  if (result.ok) {
    console.log(`\n🎉 Notification successfully delivered!`);
    console.log(`   Recipients will be redirected to: ${urlPath}`);
    console.log(`   Delivery has been logged to "push_notification_logs" table.`);
  } else {
    console.error(`\n❌ Failed to deliver push notification:`, (result as any).error || result);
  }
}

main().catch((e) => {
  console.error("❌ An unexpected error occurred:", e);
});
