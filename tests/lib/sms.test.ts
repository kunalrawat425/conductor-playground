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
  it("flow id unset: dry run, nothing sent", async () => {
    expect(await sendOrderSms("out_for_delivery", order)).toBe("dry-run: flow id unset");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("MSG91 disabled: dry run", async () => {
    vi.stubEnv("PUBLIC_ENABLE_MSG91", "false");
    expect(await sendOrderSms("confirmed", order)).toBe("dry-run: MSG91 disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("SMS_DRY_RUN logs the exact request without the authkey and with the phone masked", async () => {
    vi.stubEnv("SMS_DRY_RUN", "true");
    vi.stubEnv("MSG91_AUTH_KEY", "secret-key");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await sendOrderSms("confirmed", order)).toBe("dry-run: SMS_DRY_RUN");
    const logged = info.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain('"flow_id":"flow-confirmed"');
    expect(logged).toContain('"mobiles":"91******3210"');
    expect(logged).toContain('"var3":"Sat 25 Oct, 9-11 AM"');
    expect(logged).not.toContain("secret-key");
    expect(logged).not.toContain("9876543210");
    expect(fetchMock).not.toHaveBeenCalled();
    info.mockRestore();
  });
  it("test orders (QA seller / test buyer): dry run; pickup orders: skipped", async () => {
    expect(await sendOrderSms("confirmed", { ...order, is_test: true })).toBe("dry-run: test order");
    expect(await sendOrderSms("confirmed", { ...order, order_type: "pickup" })).toBe("skipped: not a delivery order");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("never throws when MSG91 fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect(await sendOrderSms("confirmed", order)).toBe("failed: network down");
  });
});
