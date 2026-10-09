import { call, login } from "./api.mjs";
const SELLER = { seller_id: "337904df-ef4d-4825-b3e6-7767bedf40d2", seller_phone: "9870619974" };
await login(SELLER.seller_phone, "seller");
const [orderId, ...steps] = process.argv.slice(2);
for (const s of steps) {
  const body = s.startsWith("price=") ? { ...SELLER, order_id: orderId, action: "set_final_price", final_price: Number(s.slice(6)) }
             : { ...SELLER, order_id: orderId, status: s };
  const r = await call("/api/seller/orders", body);
  console.log(`${s.padEnd(18)} → ${r.status} ${r.json.error || r.json.order?.status || r.json.reconciled_status || ""} ${r.json.order?.refund_note ? "| " + r.json.order.refund_note : ""}`);
}
