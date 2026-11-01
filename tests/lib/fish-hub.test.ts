import { describe, it, expect } from "vitest";
import { perKgRange, hubRows, hubPriceRange, hubPriceText, hubRangeRows, hubRowPriceText, hubPlace, hubTitle } from "../../src/lib/fish-hub";
import { listingAvailability } from "../../src/lib/product-offer";

describe("hubPriceRange", () => {
  const row = (low: number, high: number, perKg: { low: number; high: number } | null) =>
    ({ offer: { availability: "InStock", lowPrice: low, highPrice: high, offerCount: 1 }, perKg }) as any;
  it("uses ₹/kg across sellers when any sells by weight, else the pack prices; null for none", () => {
    expect(hubPriceRange([row(300, 600, { low: 1200, high: 1400 }), row(250, 250, { low: 1000, high: 1000 }), row(90, 90, null)])).toEqual({ low: 1000, high: 1400, unit: "kg" });
    expect(hubPriceRange([row(300, 600, null), row(250, 250, null)])).toEqual({ low: 250, high: 600, unit: "pack" });
    expect(hubPriceRange([])).toBeNull();
    expect(hubPriceText({ low: 1000, high: 1400, unit: "kg" })).toBe("₹1000–₹1400/kg");
    expect(hubPriceText({ low: 350, high: 350, unit: "pack" })).toBe("₹350 per pack");
  });
});

const kg = (price: number, bundle_size = 1, extra = {}) => ({ id: "o", unit: "kg", price, bundle_size, ...extra }) as any;

describe("perKgRange", () => {
  it("converts weight packs to ₹/kg and ignores piece pricing", () => {
    const r = perKgRange([{ is_available: true, weight_avail: 5, pricing_options: [kg(690, 0.25), kg(1200), { id: "p", unit: "piece", price: 300, bundle_size: 1 } as any] }]);
    expect(r).toEqual({ low: 1200, high: 2760 });
  });
  it("pre-order only: the regular price, not the range (range max only if no price is set)", () => {
    expect(perKgRange([{ is_available: false, is_preorder_enabled: true, pricing_options: [kg(1000, 1, { preorder_price_min: 900, preorder_price_max: 1100 })] }])).toEqual({ low: 1000, high: 1000 });
    expect(perKgRange([{ is_available: false, is_preorder_enabled: true, pricing_options: [kg(0, 1, { preorder_price_min: 900, preorder_price_max: 1100 })] }])).toEqual({ low: 1100, high: 1100 });
  });
  it("is null when the fish is only sold by the piece", () => {
    expect(perKgRange([{ is_available: true, weight_avail: 3, pricing_options: [{ id: "p", unit: "piece", price: 300, bundle_size: 1 } as any] }])).toBeNull();
  });
});

describe("hubRows", () => {
  it("names the seller's area from coordinates before the profile text", () => {
    const rows = hubRows(
      [{ id: "s1", name: "Fishtokri.com", location_name: "Mumbai", lat: 19.19, lng: 72.98 }],
      [{ seller_id: "s1", species: "surmai", is_available: true, weight_avail: 2, pricing_options: [kg(1200)] }] as any,
      "surmai",
    );
    expect(rows[0].area).toBe("Thane");
    expect(rows[0].perKg).toEqual({ low: 1200, high: 1200 });
  });
});

describe("per-kg vs per-pack rows (pomfret, 1 Nov: Fishtokri by the pack, Nomadic Catch by weight)", () => {
  const sellers = [
    { id: "ft", name: "Fishtokri", lat: 19.19, lng: 72.98 },
    { id: "nc", name: "The Nomadic Catch", lat: 19.22, lng: 72.96 },
  ];
  const piece = (price: number, label: string) => ({ id: label, unit: "piece", price, bundle_size: 1, label }) as any;
  const listings = [
    { seller_id: "ft", species: "pomfret", size_label: "200–400 g · cut pcs", is_available: true, weight_avail: 20, pricing_options: [piece(375, "200–300 g · Cut pcs"), piece(645, "300–400 g · Cut pcs")] },
    { seller_id: "ft", species: "pomfret", size_label: "400–500 g", is_available: true, weight_avail: 10, pricing_options: [piece(1050, "400–500 g · Cut pcs")] },
    { seller_id: "nc", species: "pomfret", is_available: true, weight_avail: 10, pricing_options: [kg(1099, 0.5), kg(2199)] },
  ] as any;
  const rows = hubRows(sellers, listings, "pomfret");
  const ft = rows.find((r) => r.seller === "Fishtokri")!;
  const nc = rows.find((r) => r.seller === "The Nomadic Catch")!;

  it("shows each seller's own unit: ₹/kg by weight, pack price + weight by the pack", () => {
    expect(hubRowPriceText(nc)).toBe("₹2198–₹2199/kg");
    expect(ft.perKg).toBeNull();
    expect(hubRowPriceText(ft)).toBe("₹375–₹1050 per pack (200–300 g to 400–500 g)");
  });
  it("never folds a per-pack seller into the ₹/kg range or its seller list", () => {
    expect(hubPriceRange(rows)).toEqual({ low: 2198, high: 2199, unit: "kg" });
    expect(hubRangeRows(rows).map((r) => r.seller)).toEqual(["The Nomadic Catch"]);
    expect(hubPlace(rows)).toBe("Thane");
  });
});

describe("hub availability = listingAvailability (one rule with feed and seller pages)", () => {
  // Tue 20 Oct 2026, 15:00 IST: past closing, inside the pre-order window.
  const tue3pm = Date.UTC(2026, 9, 20, 9, 30);
  const seller = { id: "s1", name: "Fishtokri", lat: 19.19, lng: 72.98, opens_at: "07:00", closes_at: "13:00", accepts_preorder: true, preorder_cutoff_time: "23:00" };
  const listing = { seller_id: "s1", species: "surmai", is_available: true, weight_avail: 5, is_preorder_enabled: true, pricing_options: [kg(1200)] };

  it("a closed seller's stocked fish is pre-order on the hub, exactly as listingAvailability says", () => {
    const row = hubRows([seller], [listing] as any, "surmai", tue3pm)[0];
    expect(row.offer.availability).toBe(listingAvailability(listing, seller, tue3pm));
    expect(row.offer.availability).toBe("PreOrder");
  });
  it("out of stock keeps the last listed price for reference", () => {
    const row = hubRows([{ ...seller, accepts_preorder: false }], [{ ...listing, is_preorder_enabled: false }] as any, "surmai", tue3pm)[0];
    expect(row.offer.availability).toBe("OutOfStock");
    expect(hubRowPriceText(row)).toBe("₹1200/kg");
  });
});

describe("hubTitle", () => {
  const row = (availability: string, area: string, perKg: { low: number; high: number } | null) =>
    ({ seller: area, area, offer: { availability, lowPrice: 500, highPrice: 500, offerCount: 1 }, perKg, packWeight: null }) as any;

  it("in stock: live ₹/kg, alias dropped when over 60", () => {
    expect(hubTitle("Surmai", "Kingfish", [row("InStock", "Thane", { low: 1098, high: 1098 })])).toBe("Surmai (Kingfish) ₹1098/kg Today in Thane | Relifish");
    expect(hubTitle("Rawas", "Indian Salmon", [row("InStock", "Thane", { low: 900, high: 1290 })])).toBe("Rawas ₹900–₹1290/kg Today in Thane | Relifish");
  });
  it("pre-order keeps the ₹/kg title (no morning/evening flip)", () => {
    expect(hubTitle("Pomfret", null, [row("PreOrder", "Thane", { low: 2198, high: 2199 }), row("PreOrder", "Thane", null)])).toBe("Pomfret ₹2198–₹2199/kg Today in Thane | Relifish");
  });
  it("out of stock or pack-only: the price-per-kg title, still with the place", () => {
    expect(hubTitle("Rawas", "Indian Salmon", [row("OutOfStock", "Thane", { low: 900, high: 900 })])).toBe("Rawas (Indian Salmon) Price per kg Today in Thane | Relifish");
    expect(hubTitle("Pomfret", null, [row("PreOrder", "Thane", null)])).toBe("Pomfret Price per kg Today in Thane | Relifish");
  });
  it("several areas: Thane if any Thane seller has it, else the area with the most sellers", () => {
    const multi = [row("PreOrder", "Tardeo", null), row("PreOrder", "Kamothe", null), row("InStock", "Thane", null)];
    expect(hubTitle("Pomfret", null, multi)).toBe("Pomfret Price per kg Today in Thane | Relifish");
    expect(hubTitle("Bangda", null, [row("InStock", "Tardeo", { low: 300, high: 300 }), row("InStock", "Tardeo", { low: 320, high: 320 }), row("InStock", "Kamothe", { low: 280, high: 280 })])).toBe("Bangda ₹280–₹320/kg Today in Tardeo | Relifish");
  });
});

describe("hubIndexable", () => {
  it("needs 2 sellers, or 1 seller plus a written guide", async () => {
    const { hubIndexable } = await import("../../src/lib/fish-hub");
    expect(hubIndexable("surmai", 1)).toBe(true); // has a guide
    expect(hubIndexable("lobster", 1)).toBe(false); // no guide yet
    expect(hubIndexable("lobster", 2)).toBe(true);
    expect(hubIndexable("surmai", 0)).toBe(false);
  });
});
