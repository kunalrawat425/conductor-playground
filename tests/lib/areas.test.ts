import { describe, it, expect } from "vitest";
import { AREAS, sellersForArea } from "../../src/lib/areas";

describe("sellersForArea", () => {
  it("keeps sellers inside the radius that match an area keyword, nearest first", () => {
    const t = AREAS.tardeo;
    const out = sellersForArea(t, [
      { id: "far", lat: t.lat + 1, lng: t.lng, location_name: "Tardeo" },
      { id: "no-kw", lat: t.lat, lng: t.lng, location_name: "Worli" },
      { id: "no-geo", lat: null, lng: null, location_name: "Tardeo" },
      { id: "b", lat: t.lat + 0.01, lng: t.lng, location_name: "Tardeo Road" },
      { id: "a", lat: t.lat, lng: t.lng, location: "South Mumbai" },
    ]);
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("areas without keywords only use the radius", () => {
    const th = AREAS.thane;
    expect(sellersForArea(th, [{ id: "x", lat: th.lat, lng: th.lng, location_name: "anything" }])).toHaveLength(1);
  });
});

describe("coveredLocalities", () => {
  it("lists only localities inside a seller's delivery radius", async () => {
    const { coveredLocalities } = await import("../../src/lib/areas");
    const kamothe = coveredLocalities("kamothe", [{ lat: 19.022, lng: 73.089, delivery_rad: 5 }]);
    expect(kamothe).toContain("Kamothe");
    expect(kamothe).toContain("Kharghar");
    expect(coveredLocalities("kamothe", [{ lat: 19.022, lng: 73.089, delivery_rad: 1 }])).not.toContain("Kharghar");
    expect(coveredLocalities("thane", [])).toEqual([]);
  });
});
