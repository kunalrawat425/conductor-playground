import { describe, it, expect } from "vitest";

/**
 * Path validation logic mirrors /api/seller/payment-screenshot.ts
 * and /api/seller/upload-refund.ts to prevent path traversal.
 */
function isPathAllowed(paths: string[], requestedPath: string): boolean {
  return paths.includes(requestedPath);
}

function buildStoragePath(orderId: string, filename: string, prefix = ""): string {
  const name = prefix ? `${prefix}-${filename}` : filename;
  return `order-payments/${orderId}/${name}`;
}

describe("screenshot path validation", () => {
  it("allows path that exists in list", () => {
    const paths = ["order-payments/abc/1234.jpg"];
    expect(isPathAllowed(paths, "order-payments/abc/1234.jpg")).toBe(true);
  });

  it("blocks path not in list", () => {
    const paths = ["order-payments/abc/1234.jpg"];
    expect(isPathAllowed(paths, "order-payments/abc/evil.jpg")).toBe(false);
  });

  it("blocks traversal attempt", () => {
    const paths = ["order-payments/abc/1234.jpg"];
    expect(isPathAllowed(paths, "../secrets/key.pem")).toBe(false);
  });

  it("blocks empty string", () => {
    expect(isPathAllowed(["order-payments/abc/1.jpg"], "")).toBe(false);
  });
});

describe("storage path construction", () => {
  it("buyer payment path has no prefix", () => {
    const p = buildStoragePath("order-1", "1234567890.jpg");
    expect(p).toBe("order-payments/order-1/1234567890.jpg");
  });

  it("refund proof path has refund- prefix", () => {
    const p = buildStoragePath("order-1", "1234567890.jpg", "refund");
    expect(p).toBe("order-payments/order-1/refund-1234567890.jpg");
    expect(p).toContain("refund-");
  });

  it("both paths share the same bucket and order folder", () => {
    const buyer = buildStoragePath("order-xyz", "ts.png");
    const refund = buildStoragePath("order-xyz", "ts.png", "refund");
    expect(buyer.startsWith("order-payments/order-xyz/")).toBe(true);
    expect(refund.startsWith("order-payments/order-xyz/")).toBe(true);
  });
});
