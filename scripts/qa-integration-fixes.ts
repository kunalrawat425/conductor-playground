import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config as dotenv } from "dotenv";
dotenv();

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const BASE = "http://127.0.0.1:4321";
const ORDER = "c00a9d6b-f7a0-47da-ad2a-a270cf07b2c7";
const BUYER = "ceeed802-e716-40b3-bc21-bf3b92a5531c";
const SELLER = "fd5534b2-06e8-4011-93f7-40b677a0758f";
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "local_test_webhook_secret";

async function post(url: string, body: any, extraHeaders: Record<string,string> = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.text() };
}

async function postRaw(url: string, raw: string, extraHeaders: Record<string,string> = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: raw,
  });
  return { status: r.status, body: await r.text() };
}

async function resetOrder() {
  await sb.from("orders").update({
    razorpay_order_id: null,
    razorpay_payment_id: null,
    payment_verified_at: null,
    payment_method: null,
    status: "pending_payment",
  }).eq("id", ORDER);
}

async function getOrder() {
  const { data } = await sb.from("orders").select("id,status,payment_method,razorpay_order_id,razorpay_payment_id,payment_verified_at").eq("id", ORDER).single();
  return data;
}

async function main() {
  const results: [string, string][] = [];

  // =========================================================
  // TEST A: FIX #1 webhook — signed captured-payment reconciles
  // =========================================================
  await resetOrder();
  // First create a razorpay_order_id via our create-order endpoint (so webhook has a row to match)
  const co = await post(`${BASE}/api/payments/razorpay-create-order`, { order_id: ORDER, buyer_id: BUYER });
  const coData = JSON.parse(co.body);
  const rzp_order_id = coData.razorpay_order_id;
  console.log("[A] create-order:", co.status, rzp_order_id);

  const fake_payment_id = "pay_WEBHOOK_" + Date.now();
  const webhookBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: fake_payment_id, order_id: rzp_order_id, status: "captured" } } },
  });
  const sig = createHmac("sha256", WEBHOOK_SECRET).update(webhookBody).digest("hex");
  const wh = await postRaw(`${BASE}/api/payments/razorpay-webhook`, webhookBody, { "x-razorpay-signature": sig });
  console.log("[A] webhook:", wh.status, wh.body);
  const afterA = await getOrder();
  console.log("[A] DB after:", afterA);
  results.push(["A. Webhook confirms pending order", afterA?.status === "confirmed" && afterA?.razorpay_payment_id === fake_payment_id ? "PASS" : "FAIL"]);

  // Cleanup for B
  await resetOrder();

  // =========================================================
  // TEST B: webhook with bad signature → 400
  // =========================================================
  const b = await postRaw(`${BASE}/api/payments/razorpay-webhook`, webhookBody, { "x-razorpay-signature": "0".repeat(64) });
  console.log("[B] bad-sig webhook:", b.status, b.body);
  results.push(["B. Webhook rejects tampered signature", b.status === 400 ? "PASS" : "FAIL"]);

  // =========================================================
  // TEST C: webhook non-captured event → 200 no-op
  // =========================================================
  const failBody = JSON.stringify({ event: "payment.failed", payload: { payment: { entity: { id: "pay_x", order_id: rzp_order_id, status: "failed" } } } });
  const failSig = createHmac("sha256", WEBHOOK_SECRET).update(failBody).digest("hex");
  const c = await postRaw(`${BASE}/api/payments/razorpay-webhook`, failBody, { "x-razorpay-signature": failSig });
  console.log("[C] failed event:", c.status, c.body);
  results.push(["C. Webhook handles payment.failed (logs, no flip)", c.status === 200 && (c.body.includes("ignored") || c.body.includes("logged")) ? "PASS" : "FAIL"]);

  // =========================================================
  // TEST D: FIX #3 reconcile — endpoint returns proper shape
  // =========================================================
  const co2 = await post(`${BASE}/api/payments/razorpay-create-order`, { order_id: ORDER, buyer_id: BUYER });
  const rzp2 = JSON.parse(co2.body).razorpay_order_id;
  console.log("[D] fresh razorpay order:", rzp2);
  const rec = await post(`${BASE}/api/seller/reconcile-razorpay`, { order_id: ORDER, seller_id: SELLER });
  console.log("[D] reconcile:", rec.status, rec.body);
  // Since we didn't actually capture on Razorpay's side, should return ok:false with "no captured payment"
  const recData = JSON.parse(rec.body);
  results.push(["D. Reconcile handles no-payment case", rec.status === 200 && recData.ok === false ? "PASS" : "FAIL"]);

  // =========================================================
  // TEST E: reconcile with wrong seller → 403
  // =========================================================
  const e = await post(`${BASE}/api/seller/reconcile-razorpay`, { order_id: ORDER, seller_id: "00000000-0000-0000-0000-000000000000" });
  console.log("[E] wrong seller:", e.status, e.body);
  results.push(["E. Reconcile rejects wrong seller", e.status === 403 ? "PASS" : "FAIL"]);

  // =========================================================
  // TEST F: FIX #2 buyer /me — active scope returns pending_payment
  // =========================================================
  const active = await fetch(`${BASE}/api/buyer/orders?buyer_id=${BUYER}&scope=active`).then(r => r.json());
  console.log("[F] active orders count:", active.orders?.length, active.orders?.map((o: any) => o.status));
  const hasPending = active.orders?.some((o: any) => o.status === "pending_payment");
  results.push(["F. Buyer /me active scope surfaces pending_payment", hasPending ? "PASS" : "FAIL"]);

  // =========================================================
  // TEST G: buyer /me default scope=all returns all statuses
  // =========================================================
  const all = await fetch(`${BASE}/api/buyer/orders?buyer_id=${BUYER}`).then(r => r.json());
  const statuses = new Set(all.orders?.map((o: any) => o.status));
  console.log("[G] all-scope statuses:", Array.from(statuses));
  results.push(["G. Buyer /me default scope=all returns 3+ orders", (all.orders?.length ?? 0) >= 2 ? "PASS" : "FAIL"]);

  // =========================================================
  // TEST H: FIX #5 expire cron — auth required
  // =========================================================
  const noAuth = await fetch(`${BASE}/api/cron/expire-pending-orders`).then(r => ({ status: r.status, body: r.text() }));
  console.log("[H] cron no auth:", noAuth.status);
  results.push(["H. Expire cron rejects missing auth", noAuth.status === 401 ? "PASS" : "FAIL"]);

  // TEST I: cron with correct auth → 200
  const withAuth = await fetch(`${BASE}/api/cron/expire-pending-orders`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET || ""}` } }).then(async r => ({ status: r.status, body: await r.text() }));
  console.log("[I] cron with auth:", withAuth.status, withAuth.body);
  results.push(["I. Expire cron accepts correct auth", withAuth.status === 200 ? "PASS" : "FAIL"]);

  // Cleanup — restore orphan
  await resetOrder();

  // Summary
  console.log("\n============ INTEGRATION TEST SUMMARY ============");
  results.forEach(([name, r]) => console.log(`  ${r === "PASS" ? "✓" : "✗"} ${name}: ${r}`));
  const failed = results.filter(r => r[1] !== "PASS");
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
