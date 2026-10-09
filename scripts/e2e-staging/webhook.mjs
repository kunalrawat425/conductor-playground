// Send a correctly signed Razorpay webhook built from the REAL payment entity.
// usage: node webhook.mjs payment.captured <razorpay_order_id> | refund.processed <payment_id>
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { BASE } from "./api.mjs";
const env = Object.fromEntries(fs.readFileSync(new URL("../../.context/staging.env", import.meta.url), "utf8").split("\n").filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const auth = "Basic " + Buffer.from(`${env.PUBLIC_RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64");
const [evt, ref] = process.argv.slice(2);
let payload;
if (evt === "payment.captured") {
  const items = (await (await fetch(`https://api.razorpay.com/v1/orders/${ref}/payments`, { headers: { Authorization: auth } })).json()).items;
  const p = items.find((x) => x.status === "captured");
  payload = { payment: { entity: p } };
} else {
  const p = await (await fetch(`https://api.razorpay.com/v1/payments/${ref}`, { headers: { Authorization: auth } })).json();
  payload = { payment: { entity: { ...p, amount_refunded: p.amount } }, refund: { entity: { id: "rfnd_synthetic_" + Date.now(), payment_id: ref, amount: p.amount } } };
}
const body = JSON.stringify({ entity: "event", event: evt, payload, created_at: Math.floor(Date.now() / 1000) });
const sig = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");
const res = await fetch(BASE + "/api/payments/razorpay-webhook", { method: "POST", headers: { "Content-Type": "application/json", "x-razorpay-signature": sig }, body });
console.log("webhook", evt, res.status, await res.text());
const bad = await fetch(BASE + "/api/payments/razorpay-webhook", { method: "POST", headers: { "Content-Type": "application/json", "x-razorpay-signature": "00" + sig.slice(2) }, body });
console.log("bad signature →", bad.status);
