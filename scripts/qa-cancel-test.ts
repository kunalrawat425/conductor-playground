import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv"; config();
const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const BASE = "http://127.0.0.1:4321";
const BUYER = "ceeed802-e716-40b3-bc21-bf3b92a5531c";

// Take an existing pending_payment order (638ef1e1 — Prawns 600, buyer ceeed802)
const ORDER = "638ef1e1-2012-4909-b067-e318a788311a";

async function post(url:string, body:any) {
  const r = await fetch(url, { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(body) });
  return { status: r.status, body: await r.text() };
}

async function getOrder() {
  const { data } = await sb.from("orders").select("id,status,cancel_reason,cancelled_by").eq("id", ORDER).single();
  return data;
}

async function main() {
  // Save original state
  const before = await getOrder();
  console.log("BEFORE:", before);

  // TEST 1: valid cancel
  const c1 = await post(`${BASE}/api/orders/cancel`, { order_id: ORDER, buyer_id: BUYER, action: "cancel", cancel_reason: "test cancel" });
  console.log("cancel:", c1);
  const after1 = await getOrder();
  console.log("AFTER cancel:", after1);

  // Revert
  await sb.from("orders").update({ status: before?.status, cancel_reason: before?.cancel_reason, cancelled_by: before?.cancelled_by }).eq("id", ORDER);
  console.log("reverted to:", await getOrder());

  // TEST 2: wrong buyer_id
  const c2 = await post(`${BASE}/api/orders/cancel`, { order_id: ORDER, buyer_id: "00000000-0000-0000-0000-000000000000", action: "cancel" });
  console.log("wrong buyer:", c2);

  // TEST 3: unknown action
  const c3 = await post(`${BASE}/api/orders/cancel`, { order_id: ORDER, buyer_id: BUYER, action: "wat" });
  console.log("unknown action:", c3);

  // TEST 4: try to cancel a confirmed order (BUG check)
  const CONFIRMED = "d7aea141-6fc5-465a-a4dd-e4f0a59cc1ac";
  // Find its buyer
  const { data: co } = await sb.from("orders").select("buyer_id").eq("id", CONFIRMED).single();
  const c4 = await post(`${BASE}/api/orders/cancel`, { order_id: CONFIRMED, buyer_id: co?.buyer_id, action: "cancel" });
  console.log("confirmed cancel:", c4);
}
main().then(() => process.exit(0));
