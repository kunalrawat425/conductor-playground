import { describe, it, expect } from "vitest";
import { pickGeocodeHit, simplifyAreaQuery } from "../../src/lib/geocode-pick";

describe("typed area search prefers Thane", () => {
  it("picks Manpada, Thane over Manpada Road, Dombivli", () => {
    const hits = [
      { display_name: "Manpada Road, Dombivli East", lat: "19.2165986", lon: "73.0893867" },
      { display_name: "Manpada, Thane", lat: "19.2314", lon: "72.9738" },
    ];
    expect(pickGeocodeHit(hits)?.display_name).toBe("Manpada, Thane");
  });
  it("handles no hits", () => {
    expect(pickGeocodeHit([])).toBeNull();
    expect(pickGeocodeHit(undefined)).toBeNull();
  });
  it("drops West/East suffixes", () => {
    expect(simplifyAreaQuery("Manpada Thane West")).toBe("Manpada Thane");
    expect(simplifyAreaQuery("Vartak Nagar (W)")).toBe("Vartak Nagar");
    expect(simplifyAreaQuery("Hiranandani Estate")).toBe("Hiranandani Estate");
  });
});
