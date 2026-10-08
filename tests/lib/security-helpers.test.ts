import { describe, it, expect } from "vitest";
import { escapeHtml, jsonLdString } from "../../src/lib/html";
import { imageExtension } from "../../src/lib/server/image-upload";
import { preorderNeedsFinalPrice } from "../../src/lib/order-payment-state";

describe("jsonLdString", () => {
  it("cannot be broken out of with </script> (stored XSS via species / seller name)", () => {
    const out = jsonLdString({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe('</script><script>alert(1)</script>');
  });
  it("accepts pre-stringified JSON", () => {
    expect(jsonLdString('{"a":"<b>"}')).toBe('{"a":"\\u003cb>"}');
  });
});

describe("escapeHtml", () => {
  it("escapes all five characters and tolerates non-strings", () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe("&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(42)).toBe("42");
  });
});

describe("imageExtension", () => {
  const file = (bytes: number[], type = "image/png") => new File([new Uint8Array(bytes)], "x", { type });
  it("judges by bytes, not declared type", async () => {
    await expect(imageExtension(file([0xff, 0xd8, 0xff, 0xe0]))).resolves.toBe("jpg");
    await expect(imageExtension(file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).resolves.toBe("png");
    await expect(imageExtension(file([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).resolves.toBe("webp");
  });
  it("rejects SVG / HTML even when labelled as an image", async () => {
    const svg = [...new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">')];
    expect(await imageExtension(file(svg, "image/png"))).toBeNull();
  });
});

describe("preorderNeedsFinalPrice", () => {
  it("every confirmed pre-order needs its final price (pickup ones never showed the button)", () => {
    expect(preorderNeedsFinalPrice({ status: "confirmed", is_preorder: true, total_price: 600, paid_amount: 600, delivery_fee: 0 })).toBe(true);
  });
  it("not once the price is set, not for same-day orders, not before confirmation", () => {
    expect(preorderNeedsFinalPrice({ status: "confirmed", is_preorder: true, final_price: 450 })).toBe(false);
    expect(preorderNeedsFinalPrice({ status: "confirmed", is_preorder: false, total_price: 500, paid_amount: 500 })).toBe(false);
    expect(preorderNeedsFinalPrice({ status: "pending_payment", is_preorder: true })).toBe(false);
  });
  it("keeps the legacy partial-advance rule", () => {
    expect(preorderNeedsFinalPrice({ status: "confirmed", total_price: 500, delivery_fee: 50, paid_amount: 500 })).toBe(true);
  });
});

import { buyerCancelRule } from "../../src/lib/order-cancel";
describe("buyerCancelRule (refund & cancellation policy)", () => {
  it("allows cancelling until the seller marks it ready", () => {
    for (const status of ["pending_payment", "paid", "payment_required"]) expect(buyerCancelRule({ status }).ok).toBe(true);
    expect(buyerCancelRule({ status: "confirmed", is_preorder: false }).ok).toBe(true);
    for (const status of ["ready_for_pickup", "out_for_delivery", "completed", "cancelled"]) expect(buyerCancelRule({ status }).ok).toBe(false);
  });
  it("confirmed pre-order: allowed while the seller's pre-order window is open, or once the price is set", () => {
    const closedNoWindow = { opens_at: "05:00", closes_at: "23:59", accepts_preorder: false };
    expect(buyerCancelRule({ status: "confirmed", is_preorder: true }, closedNoWindow).ok).toBe(false);
    expect(buyerCancelRule({ status: "confirmed", is_preorder: true, final_price: 450 }, closedNoWindow).ok).toBe(true);
  });
});
