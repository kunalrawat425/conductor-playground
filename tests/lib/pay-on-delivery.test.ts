import { describe, it, expect } from "vitest";
import { podBlockReason, isOpenPodOrder, podAwaitingPayment, POD_MAX_TOTAL, POD_REFUSAL_DAYS } from "../../src/lib/pay-on-delivery";
import { isAwaitingPayment, pickPayableCartRows, rowPaise } from "../../src/lib/server/order-cart";
import { decideSettlement, planCartSettlement } from "../../src/lib/server/razorpay-ledger";
import { sellerHearsAbout, pushStatusFor, sellerPushKindFor } from "../../src/lib/server/notify-order-parties";
import { hasPaymentEvidence } from "../../src/lib/server/reminders";
import { paymentMethodLabel } from "../../src/lib/order-payment-state";
import { cancelledByText, cancelReasonText } from "../../src/lib/order-cancel";
import { resolveBuyerStepper } from "../../src/lib/buyer-order-stepper";

/** Pay on delivery (founder, 6 Nov 2026): paid in the app at the door, never cash. */
const ok = { payable: true, sellerAccepts: true, total: 800 };

describe("podBlockReason", () => {
  it("offers it when everything holds", () => {
    expect(podBlockReason(ok)).toBeNull();
  });
  it("only at sellers who switched it on", () => {
    expect(podBlockReason({ ...ok, sellerAccepts: false })?.code).toBe("seller_off");
  });
  it(`caps the order at ₹${POD_MAX_TOTAL} (fish + delivery)`, () => {
    expect(podBlockReason({ ...ok, total: POD_MAX_TOTAL })).toBeNull();
    expect(podBlockReason({ ...ok, total: POD_MAX_TOTAL + 1 })?.code).toBe("over_limit");
  });
  it("one open pay-on-delivery order at a time, and points at it", () => {
    expect(podBlockReason({ ...ok, openOrderId: "abc" })).toMatchObject({ code: "open_order", order_id: "abc" });
  });
  it(`one refusal blocks it for ${POD_REFUSAL_DAYS} days`, () => {
    const now = Date.parse("2026-11-06T10:00:00Z");
    expect(podBlockReason({ ...ok, now, lastRefusedAt: "2026-10-01T10:00:00Z" })?.code).toBe("refused_before");
    expect(podBlockReason({ ...ok, now, lastRefusedAt: "2026-07-01T10:00:00Z" })).toBeNull();
  });
  it("not for an order that can't take it (paid, closed, already chosen)", () => {
    expect(podBlockReason({ ...ok, payable: false })?.code).toBe("not_payable");
  });
});

describe("open / awaiting payment", () => {
  it("is open until delivered or closed", () => {
    expect(isOpenPodOrder({ pay_on_delivery: true, status: "out_for_delivery" })).toBe(true);
    expect(isOpenPodOrder({ pay_on_delivery: true, status: "completed" })).toBe(false);
    expect(isOpenPodOrder({ pay_on_delivery: true, status: "cancelled" })).toBe(false);
    expect(isOpenPodOrder({ pay_on_delivery: false, status: "confirmed" })).toBe(false);
  });
  it("awaits payment until the Razorpay payment is on it", () => {
    expect(podAwaitingPayment({ pay_on_delivery: true, status: "confirmed" })).toBe(true);
    expect(podAwaitingPayment({ pay_on_delivery: true, status: "confirmed", razorpay_payment_id: "pay_1" })).toBe(false);
  });
});

describe("paying at the door", () => {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id, cart_id: "c1", buyer_id: "b1", status: "confirmed", total_price: 500, delivery_fee: 0,
    razorpay_order_id: null, razorpay_payment_id: null, created_at: id, pay_on_delivery: true, ...extra,
  });
  it("a confirmed / out-for-delivery pay-on-delivery row is still payable; a normal confirmed one is not", () => {
    expect(isAwaitingPayment(row("o1"))).toBe(true);
    expect(isAwaitingPayment(row("o1", { status: "out_for_delivery" }))).toBe(true);
    expect(isAwaitingPayment(row("o1", { pay_on_delivery: false }))).toBe(false);
    expect(isAwaitingPayment(row("o1", { razorpay_payment_id: "pay_1" }))).toBe(false);
  });
  it("one Pay press covers the cart's unpaid pay-on-delivery items", () => {
    const rows = pickPayableCartRows(row("o1") as any, [row("o1"), row("o2", { delivery_fee: 30 }), row("o3", { status: "cancelled" })] as any);
    expect(rows.map((r) => r.id)).toEqual(["o1", "o2"]);
    expect(rows.reduce((s, r) => s + rowPaise(r), 0)).toBe(103000);
  });
  it("a pay-on-delivery pre-order is charged its weighed final price", () => {
    expect(rowPaise({ total_price: 900, delivery_fee: 40, pay_on_delivery: true, final_price: 760 })).toBe(80000);
    // An upfront-paid pre-order is unchanged: its balance is a separate top-up.
    expect(rowPaise({ total_price: 900, delivery_fee: 40, pay_on_delivery: false, final_price: 760 })).toBe(94000);
  });
  it("the payment attaches to the accepted order without moving its status back to paid", () => {
    const p = { razorpay_order_id: "order_1", razorpay_payment_id: "pay_1" };
    expect(decideSettlement(row("o1", { razorpay_order_id: "order_1" }) as any, p)).toBe("stamp");
    const plan = planCartSettlement([row("o1", { razorpay_order_id: "order_1" }), row("o2", { razorpay_order_id: "order_1", status: "out_for_delivery" })] as any, p);
    expect(plan.stamp.map((r) => r.id)).toEqual(["o1", "o2"]);
    expect(plan.refund).toEqual([]);
  });
  it("paid before the seller accepted: an ordinary paid order", () => {
    expect(decideSettlement(row("o1", { status: "pending_payment", razorpay_order_id: "order_1" }) as any, { razorpay_order_id: "order_1", razorpay_payment_id: "pay_1" })).toBe("confirm");
  });
});

describe("who hears what", () => {
  it("the seller hears about a pay-on-delivery order before any money, its payment, and a buyer cancel", () => {
    expect(sellerHearsAbout("pay_on_delivery", false, true)).toBe(true);
    expect(sellerHearsAbout("pod_paid", true, true)).toBe(true);
    expect(sellerHearsAbout("cancelled_by_buyer", false, true)).toBe(true);
    // Unchanged for ordinary unpaid orders.
    expect(sellerHearsAbout("cancelled_by_buyer", false, false)).toBe(false);
    expect(sellerHearsAbout("expired_unpaid", false, true)).toBe(false);
  });
  it("maps to the right push copy", () => {
    expect(pushStatusFor("pay_on_delivery")).toBe("pod_placed");
    expect(pushStatusFor("pod_paid")).toBe("paid");
    expect(sellerPushKindFor("pay_on_delivery")).toBe("pay_on_delivery");
    expect(sellerPushKindFor("pod_paid")).toBe("pod_paid");
  });
  it("no 'payment pending' reminder for a pay-on-delivery order", () => {
    expect(hasPaymentEvidence({ pay_on_delivery: true })).toBe(true);
    expect(hasPaymentEvidence({})).toBe(false);
  });
});

describe("labels", () => {
  it("says pay on delivery, never cash", () => {
    expect(paymentMethodLabel({ pay_on_delivery: true })).toBe("Pay on delivery · in the app, no cash");
    expect(paymentMethodLabel({ pay_on_delivery: true, payment_method: "razorpay", razorpay_payment_id: "pay_1" })).toBe("Paid online · Razorpay");
  });
  it("an unconfirmed pay-on-delivery order cancelled at slot end says why", () => {
    expect(cancelledByText("system", "buyer", "seller_no_response")).toBe("Cancelled automatically — the seller didn't confirm in time");
    expect(cancelReasonText("seller_no_response")).toBeNull();
  });
});

describe("buyer stepper", () => {
  it("never ticks Paid before the buyer pays at the door", () => {
    const o = { status: "out_for_delivery", pay_on_delivery: true, razorpay_payment_id: null };
    const s = resolveBuyerStepper(o, "delivery");
    expect(s.labels).toEqual(["Placed", "Confirmed", "On the way", "Paid", "Delivered"]);
    expect(s.step).toBe(2);
    expect(resolveBuyerStepper({ ...o, razorpay_payment_id: "pay_1" }, "delivery").step).toBe(3);
    expect(resolveBuyerStepper({ status: "pending_payment", pay_on_delivery: true }, "delivery").step).toBe(0);
  });
});

import { orderSms } from "../../src/lib/server/notify-order-whatsapp";
describe("on-the-way SMS", () => {
  const ord = { id: "abcdef12-0000", status: "out_for_delivery", pay_on_delivery: true, razorpay_payment_id: null, total_price: 180, delivery_fee: 13, delivery_slot_start: null, delivery_slot_end: null };
  it("uses the pay-on-delivery text once its template is set up, else the normal one", () => {
    expect(orderSms("out_for_delivery", ord, "Asha").key).toBe("OUT");
    process.env.MSG91_FLOW_OUT_POD = "flow_test";
    expect(orderSms("out_for_delivery", ord, "Asha")).toEqual({ key: "OUT_POD", vars: ["Asha", "#ABCDEF12", "Rs.193"] });
    expect(orderSms("out_for_delivery", { ...ord, razorpay_payment_id: "pay_1" }, "Asha").key).toBe("OUT");
    delete process.env.MSG91_FLOW_OUT_POD;
  });
});

import { orderMessage } from "../../src/lib/server/notify-order-whatsapp";
describe("on-the-way WhatsApp", () => {
  it("pay on delivery adds how to pay; paid or normal orders keep rf2_out", () => {
    const ord = { id: "abcdef12-0000", status: "out_for_delivery", pay_on_delivery: true, razorpay_payment_id: null, total_price: 180, delivery_fee: 13 };
    expect(orderMessage("out_for_delivery", ord, "Asha")).toMatchObject({ template: "rf2_out_pod", body: ["#ABCDEF12", "soon", "₹193"] });
    expect(orderMessage("out_for_delivery", { ...ord, razorpay_payment_id: "pay_1" }, "Asha").template).toBe("rf2_out");
    expect(orderMessage("out_for_delivery", { ...ord, pay_on_delivery: false }, "Asha").template).toBe("rf2_out");
  });
});
