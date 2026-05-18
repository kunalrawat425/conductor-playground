import { describe, it, expect } from "vitest";
import { isPastPreorderCutoffIST } from "../../src/lib/order-timing";

describe("preorder cutoff — IST comparison", () => {
  // IST 22:00 = UTC 16:30
  const cutoff = "22:00";

  it("before cutoff in IST — allowed", () => {
    // UTC 16:00 = IST 21:30 — before 22:00
    const utc = Date.UTC(2024, 0, 15, 16, 0, 0);
    expect(isPastPreorderCutoffIST(cutoff, utc)).toBe(false);
  });

  it("exactly at cutoff — blocked", () => {
    // UTC 16:30 = IST 22:00
    const utc = Date.UTC(2024, 0, 15, 16, 30, 0);
    expect(isPastPreorderCutoffIST(cutoff, utc)).toBe(true);
  });

  it("after cutoff in IST — blocked", () => {
    // UTC 18:00 = IST 23:30
    const utc = Date.UTC(2024, 0, 15, 18, 0, 0);
    expect(isPastPreorderCutoffIST(cutoff, utc)).toBe(true);
  });

  it("IST midnight edge — early morning UTC is still previous IST day", () => {
    // UTC 00:01 = IST 05:31 — before any reasonable cutoff
    const utc = Date.UTC(2024, 0, 15, 0, 1, 0);
    expect(isPastPreorderCutoffIST(cutoff, utc)).toBe(false);
  });

  it("early cutoff 06:00 IST", () => {
    // UTC 00:30 = IST 06:00 — at cutoff
    const utc = Date.UTC(2024, 0, 15, 0, 30, 0);
    expect(isPastPreorderCutoffIST("06:00", utc)).toBe(true);
  });
});
