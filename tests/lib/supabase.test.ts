import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase client
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockGt = vi.fn();
const mockIn = vi.fn();
const mockOr = vi.fn();
const mockOrder = vi.fn();
const mockSingle = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: mockFrom,
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://example.com/photo.webp" } }),
      }),
    },
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  }),
}));

// Chain helper
function setupChain(resolvedData: any) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: resolvedData, error: null }),
  };
  // For non-single queries, resolve at order
  chain.order.mockResolvedValue({ data: resolvedData, error: null });
  mockFrom.mockReturnValue(chain);
  return chain;
}

describe("supabase queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getActiveListings filters by available and not expired", async () => {
    const mockListings = [
      { id: "1", species: "pomfret", price: 500, price_unit: "piece", is_available: true },
    ];
    const chain = setupChain(mockListings);

    const { getActiveListings } = await import("../../src/lib/supabase");
    const result = await getActiveListings();

    expect(mockFrom).toHaveBeenCalledWith("fish_listings");
    expect(chain.eq).toHaveBeenCalledWith("is_available", true);
    expect(result).toEqual(mockListings);
  });

  it("getSellerById queries sellers table", async () => {
    const mockSeller = { id: "s1", name: "Test Seller", phone: "+919999999999" };
    setupChain(mockSeller);

    const { getSellerById } = await import("../../src/lib/supabase");
    const result = await getSellerById("s1");

    expect(mockFrom).toHaveBeenCalledWith("sellers");
    expect(result).toEqual(mockSeller);
  });

  it("createListing inserts into fish_listings", async () => {
    const newListing = {
      seller_id: "s1",
      species: "pomfret",
      price: 500,
      price_unit: "piece" as const,
      weight_avail: 10,
      photo_url: null,
      listed_date: "2026-04-05",
      is_available: true,
      expires_at: new Date().toISOString(),
      pickup_loc: "Versova",
    };
    const chain = setupChain({ id: "l1", ...newListing });

    const { createListing } = await import("../../src/lib/supabase");
    const result = await createListing(newListing);

    expect(mockFrom).toHaveBeenCalledWith("fish_listings");
    expect(chain.insert).toHaveBeenCalled();
    expect(result.id).toBe("l1");
  });

  it("updateOrderStatus updates status and optional final price", async () => {
    const updatedOrder = { id: "o1", status: "confirmed", final_price: 450 };
    setupChain(updatedOrder);

    const { updateOrderStatus } = await import("../../src/lib/supabase");
    const result = await updateOrderStatus("o1", "confirmed", 450);

    expect(mockFrom).toHaveBeenCalledWith("orders");
    expect(result.status).toBe("confirmed");
    expect(result.final_price).toBe(450);
  });

  it("getSpeciesRanges returns all ranges", async () => {
    const mockRanges = [
      { id: "r1", species: "pomfret", price_unit: "piece", min_price: 400, max_price: 600 },
    ];
    setupChain(mockRanges);

    const { getSpeciesRanges } = await import("../../src/lib/supabase");
    const result = await getSpeciesRanges();

    expect(mockFrom).toHaveBeenCalledWith("species_ranges");
    expect(result).toEqual(mockRanges);
  });
});
