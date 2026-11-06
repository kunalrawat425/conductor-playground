import { afterEach, describe, expect, it, vi } from "vitest";

describe("GET /api/theme", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules(); });
  const get = async () => { const { GET } = await import("../../src/pages/api/theme"); return (await (GET as any)({})).json(); };

  it("is diwali inside the window and null after it", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-06T06:00:00Z"));
    expect(await get()).toEqual({ festive: "diwali" });
    vi.setSystemTime(new Date("2026-11-16T06:00:00Z"));
    expect(await get()).toEqual({ festive: null });
  });

  it("follows PUBLIC_FESTIVE_THEME", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-12-01T06:00:00Z"));
    vi.stubEnv("PUBLIC_FESTIVE_THEME", "diwali");
    expect(await get()).toEqual({ festive: "diwali" });
    vi.setSystemTime(new Date("2026-11-06T06:00:00Z"));
    vi.stubEnv("PUBLIC_FESTIVE_THEME", "off");
    expect(await get()).toEqual({ festive: null });
  });
});
