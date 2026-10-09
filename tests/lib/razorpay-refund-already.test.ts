import { describe, it, expect, vi, afterEach } from "vitest";

vi.stubEnv("PUBLIC_RAZORPAY_KEY_ID", "rzp_test_x");
vi.stubEnv("RAZORPAY_KEY_SECRET", "s");
const { refundRazorpayPayment } = await import("../../src/lib/server/razorpay-refund");

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());

describe("refund retry after a manual dashboard refund", () => {
  it("counts a fully refunded payment as done", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(json(400, { error: { description: "The payment has been fully refunded already" } }))
      .mockResolvedValueOnce(json(200, { amount: 100, amount_refunded: 100 })));
    const r = await refundRazorpayPayment("pay_1");
    expect(r.ok).toBe(true);
    expect(r.note).toMatch(/Already refunded/);
  });

  it("still reports a real failure when nothing was refunded", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(json(400, { error: { description: "invalid request sent" } }))
      .mockResolvedValueOnce(json(200, { amount: 100, amount_refunded: 0 })));
    const r = await refundRazorpayPayment("pay_1");
    expect(r.ok).toBe(false);
  });
});
