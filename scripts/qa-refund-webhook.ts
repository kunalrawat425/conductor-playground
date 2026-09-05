import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const BASE = "http://127.0.0.1:4321";
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET!;
const ORDER = "c00a9d6b-f7a0-47da-ad2a-a270cf07b2c7";

async function main(){
  // Seed a confirmed order via reset + webhook capture, then send refund
  await sb.from("orders").update({ razorpay_order_id: null, razorpay_payment_id: null, payment_verified_at: null, payment_method: null, status: "pending_payment", refund_note: null, refund_amt: null, refund_sent_at: null }).eq("id", ORDER);
  const co = await fetch(`${BASE}/api/payments/razorpay-create-order`, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({order_id:ORDER,buyer_id:"ceeed802-e716-40b3-bc21-bf3b92a5531c"})});
  const rzp_order = (await co.json()).razorpay_order_id;
  const fake_pay = "pay_TESTREFUND_" + Date.now();

  // Step 1: fire captured
  const capBody = JSON.stringify({event:"payment.captured",payload:{payment:{entity:{id:fake_pay,order_id:rzp_order,status:"captured"}}}});
  const capSig = createHmac("sha256", SECRET).update(capBody).digest("hex");
  const cap = await fetch(`${BASE}/api/payments/razorpay-webhook`, {method:"POST",headers:{"content-type":"application/json","x-razorpay-signature":capSig},body:capBody});
  console.log("captured:", cap.status, await cap.text());
  let { data: after1 } = await sb.from("orders").select("status,razorpay_payment_id").eq("id", ORDER).single();
  console.log("after captured DB:", after1);

  // Step 2: fire refund.processed
  const refBody = JSON.stringify({event:"refund.processed",payload:{refund:{entity:{id:"rfnd_TEST_"+Date.now(),payment_id:fake_pay,amount:180000,status:"processed"}}}});
  const refSig = createHmac("sha256", SECRET).update(refBody).digest("hex");
  const ref = await fetch(`${BASE}/api/payments/razorpay-webhook`, {method:"POST",headers:{"content-type":"application/json","x-razorpay-signature":refSig},body:refBody});
  console.log("refund:", ref.status, await ref.text());
  let { data: after2 } = await sb.from("orders").select("status,refund_note,refund_amt,refund_sent_at").eq("id", ORDER).single();
  console.log("after refund DB:", after2);

  // Cleanup
  await sb.from("orders").update({ razorpay_order_id: null, razorpay_payment_id: null, payment_verified_at: null, payment_method: null, status: "pending_payment", refund_note: null, refund_amt: null, refund_sent_at: null }).eq("id", ORDER);
  console.log("reverted");
}
main().then(()=>process.exit(0));
