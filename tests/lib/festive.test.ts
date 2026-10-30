import { describe, expect, it } from "vitest";
import { festiveTheme } from "../../src/lib/festive";

describe("festiveTheme", () => {
  it("is on from 28 Oct to 15 Nov 2026 in IST, off either side", () => {
    expect(festiveTheme(new Date("2026-10-27T18:29:00Z"), "")).toBeNull(); // 27 Oct 23:59 IST
    expect(festiveTheme(new Date("2026-10-27T18:30:00Z"), "")).toBe("diwali"); // 28 Oct 00:00 IST
    expect(festiveTheme(new Date("2026-11-15T18:29:00Z"), "")).toBe("diwali"); // 15 Nov 23:59 IST
    expect(festiveTheme(new Date("2026-11-15T18:30:00Z"), "")).toBeNull(); // 16 Nov 00:00 IST
  });

  it("env flag forces it on", () => {
    expect(festiveTheme(new Date("2027-01-01T00:00:00Z"), "diwali")).toBe("diwali");
  });

  it("env flag off forces it off inside the window", () => {
    expect(festiveTheme(new Date("2026-11-01T00:00:00Z"), "off")).toBeNull();
  });
});
