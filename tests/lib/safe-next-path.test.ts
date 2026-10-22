import { describe, it, expect } from "vitest";
import { safeNextPath } from "../../src/lib/auth";

describe("safeNextPath (?next= after login)", () => {
  it("allows same-site paths", () => {
    expect(safeNextPath("/shop")).toBe("/shop");
    expect(safeNextPath("/shop?species=prawns")).toBe("/shop?species=prawns");
    expect(safeNextPath(" /track ")).toBe("/track");
  });
  it("refuses other hosts, schemes and junk", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "shop", "", null, undefined, "/\t/evil.com", "/\n/evil.com"]) {
      expect(safeNextPath(bad as any), String(bad)).toBeNull();
    }
  });
});
