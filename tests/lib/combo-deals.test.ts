import { describe, it, expect } from "vitest";
import { bundleGroups, cartSavings, comboParts, dealSaving, isComboListing, savePct } from "../../src/lib/combo-deals";

// Shapes as on stage (Fishtokri, The Nomadic Catch).
const combo1 = { id: "c1", species: "Silver Pomfret Combo", size_label: "Combo", description: "Silver pomfret 300–400 g cut + White prawns + Bombil",
  pricing_options: [{ id: "default", label: "Combo · Silver pomfret 300–400 g cut, White prawns 10–20 pcs, Bombil fry cut 500 g", price: 1230, compare_at_price: 1395, bundle_size: 1 }] };
const combo2 = { id: "c2", species: "Silver Pomfret Combo", size_label: "Combo", description: "Silver pomfret 200–300 g cut + prawns + bombil + platter",
  pricing_options: [{ id: "default", label: "Combo · Silver pomfret 200–300 g cut, Seawater white prawns 10–20 pcs, Bombil fry cut 500 g, Frozen seafood platter", price: 1230, compare_at_price: 1380, bundle_size: 1 }] };
const pomfret = { id: "p", species: "pomfret", description: "Silver Pomfret · Cut pcs + head & tail",
  pricing_options: [{ id: "default", label: "200–300 g · Cut pcs + head & tail", price: 375 }, { id: "opt_pomfret_cut_300", label: "300–400 g · Cut pcs + head & tail", price: 645 }] };
const tarli = { id: "t", species: "Tarli (Sardine)", pricing_options: [{ id: "default", label: "500 g", price: 330, bundle_size: 0.5 }] };
const surmai = { id: "s", species: "surmai", pricing_options: [{ id: "default", label: "½ kg", price: 549, compare_at_price: 610, bundle_size: 0.5 }, { id: "opt_1", label: "1 kg", price: 1098, compare_at_price: 1220, bundle_size: 1 }] };

describe("combo detection", () => {
  it("finds combos by name and counts parts from the option label", () => {
    expect(isComboListing(combo1)).toBe(true);
    expect(isComboListing(pomfret)).toBe(false);
    expect(comboParts(combo1.pricing_options[0].label)).toHaveLength(3);
    expect(comboParts(combo2.pricing_options[0].label)).toHaveLength(4);
  });
});

describe("deal math", () => {
  it("saving and percent from compare-at only", () => {
    expect(dealSaving(combo1.pricing_options[0])).toBe(165);
    expect(savePct(combo1.pricing_options[0])).toBe(12);
    expect(savePct(combo2.pricing_options[0])).toBe(11);
    expect(dealSaving({ price: 330 })).toBe(0);
    expect(dealSaving({ price: 500, compare_at_price: 400 })).toBe(0);
    expect(dealSaving({ price: 500, compare_at_price: 600, preorder_price_max: 550 })).toBe(0);
    expect(dealSaving({ price: 500, compare_at_price: 600, preorder_price_min: 450, preorder_price_max: 500 })).toBe(0);
    // Fixed pre-order price (stage combos: min = max = price) keeps its was-price.
    expect(dealSaving({ price: 1230, compare_at_price: 1395, preorder_price_min: 1230, preorder_price_max: 1230 })).toBe(165);
  });

  it("cart savings per pack, combo part split out, repriced lines claim nothing", () => {
    const listings = [combo1, tarli, surmai];
    const items = [
      { listing_id: "c1", pricing_option_id: "default", qty: 1, price: 1230 },
      { listing_id: "t", pricing_option_id: "default", qty: 0.5, price: 660 },
      { listing_id: "s", pricing_option_id: "default", qty: 1, price: 1098 }, // two ½ kg packs
    ];
    expect(cartSavings(items, listings)).toEqual({ mrp: 1230 + 165 + 330 + 1098 + 122, saved: 165 + 122, comboSaved: 165 });
    expect(cartSavings([{ listing_id: "c1", pricing_option_id: "default", qty: 1, price: 1300 }], listings).saved).toBe(0);
  });
});

describe("bundleGroups", () => {
  it("groups combos under the base fish with the matching single pack and ribbons", () => {
    const [g, ...rest] = bundleGroups([pomfret, combo1, tarli, combo2]);
    expect(rest).toHaveLength(0);
    expect(g.base).toBe("Silver Pomfret");
    expect(g.single?.optId).toBe("opt_pomfret_cut_300");
    expect(g.combos.map((c) => c.ribbon)).toEqual(["popular", "value"]);
  });

  it("nothing without combos; no ribbons for a lone combo", () => {
    expect(bundleGroups([pomfret, tarli])).toEqual([]);
    const [g] = bundleGroups([combo1]);
    expect(g.single).toBeNull();
    expect(g.combos[0].ribbon).toBeUndefined();
  });
});
