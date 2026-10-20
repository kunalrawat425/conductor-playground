// @vitest-environment node
// (happy-dom's Request drops the Origin header, as a browser would)
import { describe, it, expect } from "vitest";
import { metaEventPayload } from "../../src/lib/server/meta-capi";
import { POST } from "../../src/pages/api/meta/event";

describe("metaEventPayload", () => {
  it("carries the pixel's event name and id, with fbp/fbc/IP/UA unhashed", () => {
    const e = metaEventPayload("AddToCart", "add_to_cart.1.abc", {
      value: 250, contents: [{ id: "L1", quantity: 1 }], fbp: "fb.1.1.2", fbc: "fb.1.1.click", ip: "1.2.3.4", ua: "UA",
    }, 1_700_000_000_000);
    expect(e.event_name).toBe("AddToCart");
    expect(e.event_id).toBe("add_to_cart.1.abc");
    expect(e.event_time).toBe(1_700_000_000);
    expect(e.user_data).toEqual({ fbp: "fb.1.1.2", fbc: "fb.1.1.click", client_ip_address: "1.2.3.4", client_user_agent: "UA" });
    expect(e.custom_data).toEqual({ value: 250, currency: "INR", contents: [{ id: "L1", quantity: 1 }], content_type: "product" });
  });
  it("leaves out IP, UA and cookie ids when unknown, and sends no PII", () => {
    const e = metaEventPayload("Purchase", "order_X", { value: 10 });
    expect(e.user_data).toEqual({});
    expect(e.custom_data).toEqual({ value: 10, currency: "INR" });
  });
});

const call = (body: unknown, origin = "https://www.relifish.com") =>
  POST({
    request: new Request("https://www.relifish.com/api/meta/event", {
      method: "POST",
      headers: { origin, "x-forwarded-for": "9.9.9.9" },
      body: JSON.stringify(body),
    }),
    url: new URL("https://www.relifish.com/api/meta/event"),
  } as any) as Promise<Response>;

describe("POST /api/meta/event", () => {
  const ok = { event_name: "AddToCart", event_id: "add_to_cart.1.abc", value: 99999, contents: [{ id: "L1", quantity: 1 }] };
  it("accepts a cart event from our own site", async () => {
    expect((await call(ok)).status).toBe(204);
  });
  it("rejects other event names and oversized ids", async () => {
    expect((await call({ ...ok, event_name: "Purchase" })).status).toBe(400);
    expect((await call({ ...ok, event_id: "x".repeat(65) })).status).toBe(400);
  });
  it("rejects another site's origin", async () => {
    expect((await call(ok, "https://evil.example")).status).toBe(403);
  });
});
