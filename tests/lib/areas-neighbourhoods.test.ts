import { describe, expect, it } from "vitest";
import { AREAS, areaNameForPoint, sellersForArea, coveredLocalities } from "../../src/lib/areas";

// Prod sellers, 25 Oct 2026.
const FISHTOKRI = { lat: 19.1906444, lng: 72.9791824, delivery_rad: "10.0", location_name: "Mumbai" };
const NOMADIC = { lat: 19.2186389, lng: 72.9557714, delivery_rad: "6.0", location_name: "Thane West" };
const BOMBAY = { lat: 18.9724356, lng: 72.8154089, delivery_rad: "10.0", location_name: "South Mumbai" };

describe("Thane neighbourhood pages", () => {
  it("show only sellers whose delivery radius covers the neighbourhood", () => {
    expect(sellersForArea(AREAS.majiwada, [FISHTOKRI, NOMADIC, BOMBAY]).map((s) => s.location_name)).toEqual(["Thane West", "Mumbai"]);
    expect(sellersForArea(AREAS["ghodbunder-road"], [FISHTOKRI, NOMADIC, BOMBAY])).toHaveLength(2);
    expect(sellersForArea(AREAS.mulund, [FISHTOKRI, NOMADIC, BOMBAY]).map((s) => s.location_name)).toEqual(["Mumbai", "Thane West"]);
    expect(sellersForArea(AREAS.mulund, [BOMBAY])).toHaveLength(0);
  });
  it("never relabel a seller's city (Fishtokri stays Thane)", () => {
    expect(areaNameForPoint(FISHTOKRI.lat, FISHTOKRI.lng)).toBe("Thane");
    expect(areaNameForPoint(NOMADIC.lat, NOMADIC.lng)).toBe("Thane");
  });
  it("list covered localities", () => {
    expect(coveredLocalities("ghodbunder-road", [FISHTOKRI, NOMADIC])).toContain("Hiranandani Estate");
  });
});
