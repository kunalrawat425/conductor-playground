import { createHmac } from "node:crypto";
import { config as dotenv } from "dotenv";
dotenv();

const ORDER_ID = "c00a9d6b-f7a0-47da-ad2a-a270cf07b2c7";
const BUYER_ID = "ceeed802-e716-40b3-bc21-bf3b92a5531c";
const RAZORPAY_ORDER = "order_TYQ5Q84jJOfeyD"; // from create-order call
const FAKE_PAYMENT = "pay_TESTFAKE" + Date.now();
const SECRET = process.env.RAZORPAY_KEY_SECRET!;

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
