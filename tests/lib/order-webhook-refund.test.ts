import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";

const SECRET = "test_webhook_secret";
const sign = (raw: string) => createHmac("sha256", SECRET).update(raw).digest("hex");

describe("razorpay webhook payload shape", () => {
  it("payment.captured payload has payment.entity", () => {
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_x", order_id: "order_x", status: "captured" } } },
    });
    const parsed = JSON.parse(body);
    expect(parsed.payload.payment.entity.status).toBe("captured");
    expect(sign(body)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refund.processed payload has refund.entity", () => {
    const body = JSON.stringify({
      event: "refund.processed",
      payload: { refund: { entity: { id: "rfnd_x", payment_id: "pay_x", amount: 199000 } } },
    });
    const parsed = JSON.parse(body);
    expect(parsed.payload.refund.entity.amount).toBe(199000);
    expect(parsed.payload.refund.entity.payment_id).toBe("pay_x");
  });

  it("refund amount in paise divides to rupees", () => {
    const amount_paise = 199000;
    expect(amount_paise / 100).toBe(1990);
  });

  it("payment.failed carries error_code + error_description", () => {
    const body = JSON.stringify({
      event: "payment.failed",
      payload: { payment: { entity: { id: "pay_x", order_id: "order_x", status: "failed", error_code: "BAD_REQUEST_ERROR", error_description: "Card declined" } } },
    });
    const parsed = JSON.parse(body);
    expect(parsed.payload.payment.entity.error_code).toBe("BAD_REQUEST_ERROR");
    expect(parsed.payload.payment.entity.error_description).toBe("Card declined");
  });
});

describe("razorpay webhook signature uniqueness", () => {
  it("different secrets → different HMACs for same body", () => {
    const body = '{"event":"payment.captured"}';
    const s1 = createHmac("sha256", "secret_a").update(body).digest("hex");
    const s2 = createHmac("sha256", "secret_b").update(body).digest("hex");
    expect(s1).not.toBe(s2);
  });

  it("byte-flipping the body invalidates signature", () => {
    const original = '{"event":"payment.captured","amt":100}';
    const tampered = '{"event":"payment.captured","amt":200}';
    expect(sign(original)).not.toBe(sign(tampered));
  });
});
