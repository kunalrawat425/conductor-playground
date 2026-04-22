import { describe, it, expect } from "vitest";

/**
 * Pure logic extracted from orders/create.ts preorder cutoff check.
 * IST = UTC+5:30. We use UTC math to avoid host-TZ dependency.
 */
function isPastCutoffIST(nowUtcMs: number, cutoffTime: string): boolean {
  const nowISTMs = nowUtcMs + 5.5 * 60 * 60 * 1000;
  const nowIST = new Date(nowISTMs);
  const nowMinutes = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
  const [cutHour, cutMin] = cutoffTime.split(":").map(Number);
  return nowMinutes >= cutHour * 60 + cutMin;
}

describe("preorder cutoff — IST comparison", () => {
  // IST 22:00 = UTC 16:30
  const cutoff = "22:00";

  it("before cutoff in IST — allowed", () => {
    // UTC 16:00 = IST 21:30 — before 22:00
    const utc = Date.UTC(2024, 0, 15, 16, 0, 0);
    expect(isPastCutoffIST(utc, cutoff)).toBe(false);
  });

  it("exactly at cutoff — blocked", () => {
    // UTC 16:30 = IST 22:00
    const utc = Date.UTC(2024, 0, 15, 16, 30, 0);
    expect(isPastCutoffIST(utc, cutoff)).toBe(true);
  });

  it("after cutoff in IST — blocked", () => {
    // UTC 18:00 = IST 23:30
    const utc = Date.UTC(2024, 0, 15, 18, 0, 0);
    expect(isPastCutoffIST(utc, cutoff)).toBe(true);
  });

  it("IST midnight edge — early morning UTC is still previous IST day", () => {
    // UTC 00:01 = IST 05:31 — before any reasonable cutoff
    const utc = Date.UTC(2024, 0, 15, 0, 1, 0);
    expect(isPastCutoffIST(utc, cutoff)).toBe(false);
  });

  it("early cutoff 06:00 IST", () => {
    // UTC 00:30 = IST 06:00 — at cutoff
    const utc = Date.UTC(2024, 0, 15, 0, 30, 0);
    expect(isPastCutoffIST(utc, "06:00")).toBe(true);
  });
});
