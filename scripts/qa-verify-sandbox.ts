import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config as dotenv } from "dotenv";
dotenv();

const ORDER_ID = "c00a9d6b-f7a0-47da-ad2a-a270cf07b2c7";
const BUYER_ID = "ceeed802-e716-40b3-bc21-bf3b92a5531c";
const SECRET = process.env.RAZORPAY_KEY_SECRET!;
const FAKE_PAYMENT = "pay_TESTFAKE" + Date.now();

// Fetch current razorpay_order_id from DB (write path assigns it via create-order)
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data: row } = await sb.from("orders").select("razorpay_order_id").eq("id", ORDER_ID).single();
const RAZORPAY_ORDER = (row as any)?.razorpay_order_id;
if (!RAZORPAY_ORDER) { console.error("No razorpay_order_id on row — run create-order first"); process.exit(1); }
console.log("using razorpay_order:", RAZORPAY_ORDER);

async function post(url: string, body: any) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text };
}

async function main() {
  console.log("=== Test 1: valid signature → expect status=confirmed ===");
  const sig = createHmac("sha256", SECRET).update(`${RAZORPAY_ORDER}|${FAKE_PAYMENT}`).digest("hex");
  const r1 = await post("http://127.0.0.1:4321/api/payments/razorpay-verify", {
    razorpay_order_id: RAZORPAY_ORDER,
    razorpay_payment_id: FAKE_PAYMENT,
    razorpay_signature: sig,
    order_id: ORDER_ID,
    buyer_id: BUYER_ID,
  });
  console.log("verify response:", r1);

  console.log("\n=== Test 2: replay same request → expect idempotent 200 ===");
  const r2 = await post("http://127.0.0.1:4321/api/payments/razorpay-verify", {
    razorpay_order_id: RAZORPAY_ORDER,
    razorpay_payment_id: FAKE_PAYMENT,
    razorpay_signature: sig,
    order_id: ORDER_ID,
    buyer_id: BUYER_ID,
  });
  console.log("replay response:", r2);

  console.log("\n=== Test 3: tampered signature → expect 400 ===");
  const r3 = await post("http://127.0.0.1:4321/api/payments/razorpay-verify", {
    razorpay_order_id: RAZORPAY_ORDER,
    razorpay_payment_id: FAKE_PAYMENT,
    razorpay_signature: "0".repeat(64),
    order_id: ORDER_ID,
    buyer_id: BUYER_ID,
  });
  console.log("tampered response:", r3);

  console.log("\n=== Test 4: wrong buyer_id → expect 403 ===");
  const r4 = await post("http://127.0.0.1:4321/api/payments/razorpay-verify", {
    razorpay_order_id: RAZORPAY_ORDER,
    razorpay_payment_id: FAKE_PAYMENT + "b",
    razorpay_signature: createHmac("sha256", SECRET).update(`${RAZORPAY_ORDER}|${FAKE_PAYMENT}b`).digest("hex"),
    order_id: ORDER_ID,
    buyer_id: "00000000-0000-0000-0000-000000000000",
  });
  console.log("wrong-buyer response:", r4);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
