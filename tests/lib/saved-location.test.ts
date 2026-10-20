import { describe, it, expect, vi, beforeEach } from "vitest";
import { readSavedLocation, loadSavedLocation } from "../../src/lib/saved-location";

const from = (o: Record<string, string>) => (k: string) => (k in o ? o[k] : null);
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  clear: () => mem.clear(),
};

describe("readSavedLocation", () => {
  it("reads the navbar keys first", () => {
    expect(readSavedLocation(from({ rlf_buyer_lat: "19.2183", rlf_buyer_lng: "72.9781", rlf_buyer_location: "Thane West", rlf_location: '{"lat":1,"lng":2,"name":"x"}' })))
      .toEqual({ lat: 19.2183, lng: 72.9781, area: "Thane West" });
  });

  it("falls back to the old zepto keys, then the rlf_location / v2_buyer_location JSON", () => {
    expect(readSavedLocation(from({ zepto_buyer_lat: "18.9", zepto_buyer_lng: "72.8" }))).toEqual({ lat: 18.9, lng: 72.8, area: "" });
    expect(readSavedLocation(from({ rlf_location: '{"lat":19.03,"lng":73.1,"name":"Kamothe"}' }))).toEqual({ lat: 19.03, lng: 73.1, area: "Kamothe" });
    expect(readSavedLocation(from({ v2_buyer_location: '{"lat":19.1,"lng":72.9,"area":"Tardeo"}' }))).toEqual({ lat: 19.1, lng: 72.9, area: "Tardeo" });
  });

  it("ignores empty, zero, out-of-range and broken values", () => {
    expect(readSavedLocation(from({}))).toBeNull();
    expect(readSavedLocation(from({ rlf_buyer_lat: "", rlf_buyer_lng: "" }))).toBeNull();
    expect(readSavedLocation(from({ rlf_buyer_lat: "0", rlf_buyer_lng: "0" }))).toBeNull();
    expect(readSavedLocation(from({ rlf_buyer_lat: "190", rlf_buyer_lng: "72" }))).toBeNull();
    expect(readSavedLocation(from({ rlf_location: "{not json" }))).toBeNull();
    // area name alone (no pin) is not a location to centre on
    expect(readSavedLocation(from({ rlf_buyer_location: "Thane" }))).toBeNull();
  });
});

describe("loadSavedLocation", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it("uses this device's location without calling the server", async () => {
    localStorage.setItem("rlf_buyer_lat", "19.2"); localStorage.setItem("rlf_buyer_lng", "72.97");
    const f = vi.spyOn(globalThis, "fetch");
    expect(await loadSavedLocation()).toEqual({ lat: 19.2, lng: 72.97, area: "" });
    expect(f).not.toHaveBeenCalled();
  });

  it("takes a logged-in buyer's account location and keeps it on the device", async () => {
    localStorage.setItem("rlf_buyer_id", "b1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ profile: { lat: "19.2183", lng: "72.9781", location_name: "Thane West" } })));
    expect(await loadSavedLocation()).toEqual({ lat: 19.2183, lng: 72.9781, area: "Thane West" });
    expect([localStorage.getItem("rlf_buyer_lat"), localStorage.getItem("rlf_buyer_lng"), localStorage.getItem("rlf_buyer_location")]).toEqual(["19.2183", "72.9781", "Thane West"]);
  });

  it("returns null for a guest with nothing saved, and when the account has no pin", async () => {
    expect(await loadSavedLocation()).toBeNull();
    localStorage.setItem("rlf_buyer_id", "b1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ profile: { lat: null, lng: null } })));
    expect(await loadSavedLocation()).toBeNull();
    expect(localStorage.getItem("rlf_buyer_lat")).toBeNull();
  });
});
