import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { orderSmsVars, renderOrderSms, sendOrderSms, smsVar, ORDER_SMS_TEMPLATES } from "../../src/lib/server/sms";

const order = { id: "ab12cd34-0000-4000-8000-000000000000", phone: "9876543210", fish: "Rohu", when: "Sat 25 Oct, 9–11 AM", order_type: "delivery" };

describe("order SMS text", () => {
  it("fills the DLT variables in ASCII, at most 30 characters", () => {
    expect(orderSmsVars("confirmed", order)).toEqual(["#AB12CD34", "Rohu", "Sat 25 Oct, 9-11 AM"]);
    expect(smsVar("Pomfret (Silver) + Surmai + Prawns + 3 more")).toHaveLength(30);
    expect(smsVar("Rawas ₹ – fresh")).toBe("Rawas - fresh");
  });
  it("every filled template fits one 160-character SMS", () => {
    const long = { ...order, fish: "x".repeat(40), when: "Wed 28 Oct, 11:30 AM-12:30 PM" };
    for (const status of Object.keys(ORDER_SMS_TEMPLATES) as (keyof typeof ORDER_SMS_TEMPLATES)[]) {
      const text = renderOrderSms(status, orderSmsVars(status, long));
      expect(text, status).not.toContain("{#var#}");
      expect(text.length, status).toBeLessThanOrEqual(160);
    }
  });
});

describe("sendOrderSms", () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ type: "success" })));
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("PUBLIC_ENABLE_MSG91", "true");
    vi.stubEnv("MSG91_FLOW_ORDER_CONFIRMED", "flow-confirmed");
    vi.stubEnv("MSG91_FLOW_OUT_FOR_DELIVERY", "");
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetchMock.mockClear(); });

  it("sends the confirmed flow with the variables", async () => {
    expect(await sendOrderSms("confirmed", order)).toBe("sent");
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body).toMatchObject({ flow_id: "flow-confirmed", mobiles: "919876543210", var1: "#AB12CD34", var2: "Rohu", var3: "Sat 25 Oct, 9-11 AM" });
  });
  it("skips silently when the flow id is unset", async () => {
    expect(await sendOrderSms("out_for_delivery", order)).toBe("skipped: flow id unset");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("skips when MSG91 is disabled", async () => {
    vi.stubEnv("PUBLIC_ENABLE_MSG91", "false");
    expect(await sendOrderSms("confirmed", order)).toBe("skipped: MSG91 disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("skips test orders (QA seller / test buyer) and pickup orders", async () => {
    expect(await sendOrderSms("confirmed", { ...order, is_test: true })).toBe("skipped: test order");
    expect(await sendOrderSms("confirmed", { ...order, order_type: "pickup" })).toBe("skipped: not a delivery order");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("never throws when MSG91 fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect(await sendOrderSms("confirmed", order)).toBe("failed: network down");
  });
});
