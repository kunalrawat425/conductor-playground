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
});
