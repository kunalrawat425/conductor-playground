import { describe, it, expect } from "vitest";
import { compareMenuOrder, menuBySeller, moveInMenu } from "../../src/lib/menu-order";

describe("menuBySeller (/shop seller cards)", () => {
  it("returns each seller's items in menu order, whatever order the query returned them", () => {
    // Storage order after the seller moved pomfret to the top: updated rows come back last.
    const fromDb = [
      { id: "surmai", seller: "a", created_at: "2026-10-01T10:00:00Z", sort_order: 2 },
      { id: "x1", seller: "b", created_at: "2026-10-01T09:00:00Z", sort_order: null },
      { id: "prawns", seller: "a", created_at: "2026-10-01T10:02:00Z", sort_order: 3 },
      { id: "pomfret", seller: "a", created_at: "2026-10-01T10:01:00Z", sort_order: 1 },
      { id: "nosell", seller: "", created_at: "2026-10-01T09:00:00Z" },
    ];
    const m = menuBySeller(fromDb, (r) => r.seller);
    expect(m.get("a")!.map((r) => r.id)).toEqual(["pomfret", "surmai", "prawns"]);
    expect(m.get("b")!.map((r) => r.id)).toEqual(["x1"]);
    expect(m.size).toBe(2);
  });
});
import { validateListingPricingJson } from "../../src/lib/listing-pricing";

// The Nomadic Catch: added surmai first, halwa last.
const rows = [
  { id: "halwa", created_at: "2026-10-01T10:05:00Z" },
  { id: "surmai", created_at: "2026-10-01T10:00:00Z" },
  { id: "prawns", created_at: "2026-10-01T10:02:00Z" },
  { id: "pomfret", created_at: "2026-10-01T10:01:00Z" },
];

describe("compareMenuOrder", () => {
  it("without sort_order, shows items in the order the seller added them", () => {
    expect([...rows].sort(compareMenuOrder).map((r) => r.id)).toEqual(["surmai", "pomfret", "prawns", "halwa"]);
  });

  it("puts arranged items first, unset (null) ones after, oldest first", () => {
    const mixed = [...rows.map((r) => ({ ...r, sort_order: null as number | null })), { id: "bangda", created_at: "2026-10-02T00:00:00Z", sort_order: 1 }];
    mixed[0].sort_order = 2; // halwa
    expect(mixed.sort(compareMenuOrder).map((r) => r.id)).toEqual(["bangda", "halwa", "surmai", "pomfret", "prawns"]);
  });
});

describe("moveInMenu", () => {
  it("swaps with the neighbour", () => {
    expect(moveInMenu(rows, "prawns", "up")).toEqual(["surmai", "prawns", "pomfret", "halwa"]);
    expect(moveInMenu(rows, "surmai", "down")).toEqual(["pomfret", "surmai", "prawns", "halwa"]);
  });

  it("is a no-op at the ends and null for an unknown id", () => {
    expect(moveInMenu(rows, "surmai", "up")).toEqual(["surmai", "pomfret", "prawns", "halwa"]);
    expect(moveInMenu(rows, "halwa", "down")).toEqual(["surmai", "pomfret", "prawns", "halwa"]);
    expect(moveInMenu(rows, "someone-elses", "up")).toBeNull();
  });
});

describe("max 3 packs per item", () => {
  const tier = (n: number) => ({ id: `t${n}`, label: `${n} pc`, price: 100 * n, unit: "piece", bundle_size: n });

  it("accepts 3 packs", () => {
    expect(validateListingPricingJson(JSON.stringify([tier(1), tier(2), tier(3)])).ok).toBe(true);
  });

  it("rejects a 4th pack and asks to remove extras", () => {
    const r = validateListingPricingJson(JSON.stringify([tier(1), tier(2), tier(3), tier(4)]));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/Up to 3 pack sizes/);
  });
});
