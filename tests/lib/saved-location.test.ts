import { describe, it, expect, vi, beforeEach } from "vitest";
import { readSavedLocation, loadSavedLocation, saveGpsDefault, saveConfirmedLocation } from "../../src/lib/saved-location";

const from = (o: Record<string, string>) => (k: string) => (k in o ? o[k] : null);
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
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

describe("saveGpsDefault", () => {
  it("stores GPS only when nothing is saved", () => {
    const o: Record<string, string> = {};
    expect(saveGpsDefault(from(o), (k, v) => void (o[k] = v), { lat: 19.12, lng: 72.85, area: "Andheri West" })).toBe(true);
    expect(o).toEqual({ rlf_buyer_lat: "19.12", rlf_buyer_lng: "72.85", rlf_buyer_location: "Andheri West" });
  });

  it("never overwrites a location the buyer picked on the map", () => {
    const o: Record<string, string> = { rlf_buyer_lat: "19.2183", rlf_buyer_lng: "72.9781", rlf_buyer_location: "Thane West" };
    expect(saveGpsDefault(from(o), (k, v) => void (o[k] = v), { lat: 19.12, lng: 72.85, area: "Andheri West" })).toBe(false);
    expect(o.rlf_buyer_lat).toBe("19.2183");
    expect(o.rlf_buyer_location).toBe("Thane West");
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

describe("saveConfirmedLocation", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
  const thane = { lat: 19.2183, lng: 72.9781, area: "Thane West" };

  it("replaces every older copy on the device, so none can win the map pick back", async () => {
    // Two locations: GPS "current" on the navbar keys and the v1 JSON, plus old zepto keys.
    localStorage.setItem("rlf_buyer_lat", "19.1197"); localStorage.setItem("rlf_buyer_lng", "72.8464"); localStorage.setItem("rlf_buyer_location", "Andheri West");
    localStorage.setItem("rlf_location", '{"lat":19.1197,"lng":72.8464,"name":"Your location"}');
    localStorage.setItem("zepto_buyer_lat", "19.1"); localStorage.setItem("zepto_buyer_lng", "72.8"); localStorage.setItem("zepto_location", '{"lat":19.1,"lng":72.8}');
    const f = vi.spyOn(globalThis, "fetch");
    await saveConfirmedLocation(thane);
    const get = (k: string) => localStorage.getItem(k);
    expect(readSavedLocation(get)).toEqual(thane);
    expect(JSON.parse(get("rlf_location")!)).toEqual({ lat: 19.2183, lng: 72.9781, name: "Thane West" });
    expect([get("zepto_buyer_lat"), get("zepto_buyer_lng"), get("zepto_location")]).toEqual([null, null, null]);
    expect(f).not.toHaveBeenCalled(); // guest: nothing to sync
  });

  it("saves a logged-in buyer's pick on the account right away", async () => {
    localStorage.setItem("rlf_buyer_id", "b1");
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await saveConfirmedLocation(thane);
    expect(f).toHaveBeenCalledWith("/api/buyer/profile", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toEqual({ buyer_id: "b1", updates: { lat: 19.2183, lng: 72.9781, location_name: "Thane West" } });
    expect(localStorage.getItem("rlf_loc_synced")).toBe("19.2183,72.9781");
  });

  it("leaves the sync key unset when the account save fails, so the page-load sync retries", async () => {
    localStorage.setItem("rlf_buyer_id", "b1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    await saveConfirmedLocation(thane);
    expect(localStorage.getItem("rlf_buyer_lat")).toBe("19.2183");
    expect(localStorage.getItem("rlf_loc_synced")).toBeNull();
  });
});
