import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch for API calls
const mockFetch = vi.fn();
(globalThis as any).fetch = mockFetch;

// Mock localStorage
const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, val: string) => { store[key] = val; },
  removeItem: (key: string) => { delete store[key]; },
};

describe("auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(store).forEach((k) => delete store[k]);
    // reset
  });

  it("sendOtp calls /api/auth/send-otp", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    const { sendOtp } = await import("../../src/lib/auth");
    await sendOtp("+919876543210");
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/send-otp", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ phone: "+919876543210" }),
    }));
  });

  it("sendOtp throws on error response", async () => {
    mockFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "Rate limited" }) });
    const { sendOtp } = await import("../../src/lib/auth");
    await expect(sendOtp("+919876543210")).rejects.toThrow("Rate limited");
  });

  it("verifyOtp stores buyer_id and phone in localStorage", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, buyer_id: "b1", phone: "9876543210" }),
    });
    const { verifyOtp } = await import("../../src/lib/auth");
    const data = await verifyOtp("+919876543210", "123456");
    expect(data.buyer_id).toBe("b1");
    expect(store.zepto_buyer_id).toBe("b1");
    expect(store.zepto_phone).toBe("9876543210");
  });

  it("getSession returns session from localStorage", async () => {
    store.zepto_buyer_id = "b1";
    store.zepto_phone = "9876543210";
    const { getSession } = await import("../../src/lib/auth");
    const session = getSession();
    expect(session?.buyer_id).toBe("b1");
    expect(session?.phone).toBe("9876543210");
  });

  it("getSession returns null when not logged in", async () => {
    const { getSession } = await import("../../src/lib/auth");
    expect(getSession()).toBeNull();
  });

  it("signOut clears localStorage", async () => {
    store.zepto_buyer_id = "b1";
    store.zepto_phone = "9876543210";
    const { signOut } = await import("../../src/lib/auth");
    signOut();
    expect(store.zepto_buyer_id).toBeUndefined();
    expect(store.zepto_phone).toBeUndefined();
  });

  it("getBuyerAddressFromStorage returns null when unset", async () => {
    const { getBuyerAddressFromStorage } = await import("../../src/lib/auth");
    expect(getBuyerAddressFromStorage()).toBeNull();
  });

  it("getBuyerAddressFromStorage returns area name without coordinates", async () => {
    store.zepto_location = JSON.stringify({
      name: "Andheri West",
      lat: 19.123456789,
      lng: 72.987654321,
    });
    const { getBuyerAddressFromStorage } = await import("../../src/lib/auth");
    expect(getBuyerAddressFromStorage()).toBe("Andheri West");
  });

  it("getBuyerAddressFromStorage uses map pin label when no area name", async () => {
    store.zepto_location = JSON.stringify({ lat: 19.1, lng: 72.8 });
    const { getBuyerAddressFromStorage } = await import("../../src/lib/auth");
    expect(getBuyerAddressFromStorage()).toBe("Map pin");
  });

  it("formatNewCheckoutAddress merges address detail and map area from storage", async () => {
    store.zepto_location = JSON.stringify({ name: "Bandra", lat: 19.06, lng: 72.83 });
    store.zepto_address_detail = JSON.stringify({
      flat: "402 A",
      building: "Ocean View",
      landmark: "Near station",
    });
    const { getBuyerAddressDetailFromStorage } = await import("../../src/lib/auth");
    const { formatNewCheckoutAddress } = await import("../../src/lib/buyer-address");
    expect(formatNewCheckoutAddress(getBuyerAddressDetailFromStorage())).toBe(
      "402 A, Ocean View, Near station — Bandra"
    );
  });

  it("saveBuyerAddressDetailToStorage clears when all empty", async () => {
    store.zepto_address_detail = "{}";
    const { saveBuyerAddressDetailToStorage, getBuyerAddressDetailFromStorage } = await import(
      "../../src/lib/auth"
    );
    saveBuyerAddressDetailToStorage({ flat: "  ", building: "", landmark: "" });
    expect(store.zepto_address_detail).toBeUndefined();
    expect(Object.keys(getBuyerAddressDetailFromStorage()).length).toBe(0);
  });
});
