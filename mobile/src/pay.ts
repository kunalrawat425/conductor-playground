import { Linking, NativeModules, Platform } from "react-native";
import { API, api, getSession } from "./api";

/**
 * Native Razorpay checkout (UPI apps open directly), then the same server checks the website uses:
 * create-order → checkout → verify; on close, sync asks Razorpay whether the money landed anyway.
 * Returns "paid", "cancelled" or "already".
 */
export async function payOrder(orderId: string): Promise<"paid" | "cancelled" | "already"> {
  const me = await getSession();
  if (!me) throw new Error("Please log in again");
  let created: any;
  try {
    created = await api("/api/payments/razorpay-create-order", { order_id: orderId, buyer_id: me.buyer_id });
  } catch (e: any) {
    if (e.status === 409 && e.data?.error_code === "already_paid") return "already";
    throw e;
  }
  const opts = {
    key: created.key_id, order_id: created.razorpay_order_id, amount: created.amount, currency: created.currency || "INR",
    name: "Relifish", description: `Order #${orderId.slice(0, 8).toUpperCase()}`, theme: { color: "#0066FF" },
    prefill: { contact: me.phone },
  };
  const verify = (r: any) => api("/api/payments/razorpay-verify", {
    razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature,
    order_id: orderId, buyer_id: me.buyer_id,
  });
  // Browser preview: Razorpay's web checkout, same order and the same verify as the native sheet.
  if (Platform.OS === "web") {
    const w = globalThis as any;
    if (!w.Razorpay) await new Promise((ok, fail) => { const el = document.createElement("script"); el.src = "https://checkout.razorpay.com/v1/checkout.js"; el.onload = ok; el.onerror = fail; document.body.appendChild(el); });
    return new Promise((resolve, reject) => {
      new w.Razorpay({ ...opts, handler: (r: any) => verify(r).then(() => resolve("paid"), reject), modal: { ondismiss: () => resolve("cancelled") } }).open();
    });
  }
  // Expo Go has no Razorpay native module: pay on the website for that preview; the installed app pays natively.
  if (!NativeModules.RNRazorpayCheckout) {
    await Linking.openURL(`${API}/track/${orderId}?pay=1`);
    return "cancelled";
  }
  const RazorpayCheckout = require("react-native-razorpay").default;
  try {
    const r: any = await RazorpayCheckout.open(opts);
    await verify(r);
    return "paid";
  } catch (e: any) {
    // Closed, or a UPI app took over and never came back: ask the server if the money is in.
    const sync = await api<{ changed?: boolean }>("/api/payments/razorpay-sync", { order_id: orderId, buyer_id: me.buyer_id }).catch(() => null);
    if (sync?.changed) return "paid";
    if (e?.code === 0 || /cancel/i.test(String(e?.description || e?.message))) return "cancelled";
    throw new Error(e?.description || e?.message || "Payment failed. Please try again.");
  }
}
