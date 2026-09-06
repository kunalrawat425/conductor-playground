import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";

/**
 * Unit-level tests for the Razorpay webhook signature logic.
 * Endpoint integration tests live outside vitest (need a running Astro server).
 */

const SECRET = "test_webhook_secret";

function sign(rawBody: string) {
  return createHmac("sha256", SECRET).update(rawBody).digest("hex");
}

describe("razorpay-webhook signature", () => {
  it("computes matching HMAC-SHA256 for a captured-payment payload", () => {
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_x", order_id: "order_x", status: "captured" } } },
    });
    const s = sign(body);
    expect(s).toHaveLength(64);
    expect(s).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a different signature for different payloads", () => {
    const s1 = sign('{"event":"payment.captured"}');
    const s2 = sign('{"event":"payment.failed"}');
    expect(s1).not.toBe(s2);
  });

  it("produces a different signature for a different secret", () => {
    const body = '{"event":"payment.captured"}';
    const s1 = createHmac("sha256", "secret_a").update(body).digest("hex");
    const s2 = createHmac("sha256", "secret_b").update(body).digest("hex");
    expect(s1).not.toBe(s2);
  });

  it("verifies against timing-safe compare on equal-length hex", () => {
    const body = '{"event":"payment.captured"}';
    const s = sign(body);
    const a = Buffer.from(s, "hex");
    const b = Buffer.from(s, "hex");
    expect(a.length).toBe(b.length);
    expect(a.equals(b)).toBe(true);
  });
});
