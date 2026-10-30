import { describe, it, expect, vi, afterEach } from "vitest";
import { celebrate, canPlaySound } from "../../src/lib/fireworks";

afterEach(() => vi.unstubAllGlobals());

describe("fireworks", () => {
  it("does nothing for reduced motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const before = document.body.childElementCount;
    await celebrate(10);
    expect(document.body.childElementCount).toBe(before);
  });
  it("plays sound only after a tap on the page", () => {
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: false } });
    expect(canPlaySound()).toBe(false);
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: true } });
    expect(canPlaySound()).toBe(true);
  });
});
