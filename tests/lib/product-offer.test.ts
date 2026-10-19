import { describe, expect, it } from "vitest";
import { listingAvailability, productJsonLd, speciesOffer } from "../../src/lib/product-offer";

const opt = (price: number, extra: Record<string, unknown> = {}) => ({ id: "x", label: "Option", price, unit: "kg" as const, ...extra });

describe("speciesOffer", () => {
  it("same-day stock wins: InStock with the range across listings and tiers", () => {
    const o = speciesOffer([
      { is_available: true, weight_avail: "14.65", pricing_options: [opt(735)] },
      { is_available: true, weight_avail: 15, pricing_options: [opt(510)] },
    ]);
    expect(o).toEqual({ availability: "InStock", lowPrice: 510, highPrice: 735, offerCount: 2 });
  });
  it("paused or zero-stock listings are not same-day; pre-order shows the regular price, not the range", () => {
    const o = speciesOffer([
      { is_available: true, is_order_paused: true, weight_avail: 5, is_preorder_enabled: true, pricing_options: [opt(700, { preorder_price_min: 650, preorder_price_max: 800 })] },
      { is_available: true, weight_avail: 0, pricing_options: [opt(500)] },
    ]);
    expect(o).toEqual({ availability: "PreOrder", lowPrice: 700, highPrice: 700, offerCount: 1 });
  });
  it("pre-order falls back to the tier price when no range is set", () => {
    expect(speciesOffer([{ is_preorder_enabled: true, pricing_options: [opt(375)] }])?.lowPrice).toBe(375);
  });
  it("nothing orderable: OutOfStock with last prices; nothing priced: null", () => {
    expect(speciesOffer([{ is_available: false, pricing_options: [opt(320)] }])?.availability).toBe("OutOfStock");
    expect(speciesOffer([{ is_available: true, weight_avail: 3, pricing_options: [opt(0)] }])).toBeNull();
    expect(speciesOffer([])).toBeNull();
  });
});

describe("productJsonLd", () => {
  const base = { name: "Surmai — Fishtokri", description: "d", url: "https://www.relifish.store/s/fishtokri-com/surmai", sellerName: "Fishtokri" };
  it("single price -> Offer", () => {
    const p = productJsonLd({ ...base, offer: { availability: "InStock", lowPrice: 690, highPrice: 690, offerCount: 1 } });
    expect(p.offers).toMatchObject({ "@type": "Offer", price: 690, priceCurrency: "INR", availability: "https://schema.org/InStock" });
  });
  it("price range -> AggregateOffer with seller", () => {
    const p = productJsonLd({ ...base, offer: { availability: "PreOrder", lowPrice: 650, highPrice: 800, offerCount: 2 } });
    expect(p.offers).toMatchObject({ "@type": "AggregateOffer", lowPrice: 650, highPrice: 800, seller: { name: "Fishtokri" } });
  });
});

describe("listingAvailability (merchant feed + /s/<slug>/<species>)", () => {
  // Tue 20 Oct 2026, 10:00 IST (04:30 UTC)
  const tue10am = Date.UTC(2026, 9, 20, 4, 30);
  const listing = { is_available: true, weight_avail: 5, is_preorder_enabled: true };
  const hours = { opens_at: "07:00", closes_at: "13:00", preorder_cutoff_time: "23:00" };
  const all = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const noTue = all.filter((d) => d !== "tue");

  it("open day, before closing time: in stock", () => {
    expect(listingAvailability(listing, { ...hours, open_days: all, accepts_preorder: true }, tue10am)).toBe("InStock");
  });
  it("closed day with pre-orders on: pre-order, even with stock", () => {
    expect(listingAvailability(listing, { ...hours, open_days: noTue, accepts_preorder: true, preorder_days: all }, tue10am)).toBe("PreOrder");
  });
  it("closed day with pre-orders off: out of stock", () => {
    expect(listingAvailability(listing, { ...hours, open_days: noTue, accepts_preorder: false, preorder_days: all }, tue10am)).toBe("OutOfStock");
  });
});
