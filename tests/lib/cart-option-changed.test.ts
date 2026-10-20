import { describe, it, expect, beforeEach } from "vitest";
import { getListingOptionById } from "../../src/lib/listing-pricing";
import { resolveListingOrderLine } from "../../src/lib/server/resolve-listing-order-line";

/**
 * A cart line's pack (pricing option) was removed or resized after it went in the cart.
 * Before: the server silently charged option 0, or fractional pre-order packs.
 */

type Row = Record<string, any>;
const db: Record<string, Row[]> = { sellers: [], fish_listings: [], orders: [] };
function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const rows = () => db[table].filter((r) => filters.every((f) => f(r)));
  const q: any = {
    select: () => q,
    eq: (k: string, v: any) => { filters.push((r) => r[k] === v); return q; },
    gte: () => q,
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
  };
  return q;
}
const fake = { from: (t: string) => query(t) } as any;

const IST = 5.5 * 3600_000;
const SAME_DAY = Date.UTC(2024, 0, 15, 9, 0) - IST;
const PREORDER = Date.UTC(2024, 0, 15, 18, 0) - IST;
const OPTS = [
  { id: "opt_0", label: "Per kg", price: 600, unit: "kg", bundle_size: 1, preorder_price_max: 700 },
  { id: "opt_1", label: "Half kg", price: 320, unit: "kg", bundle_size: 0.5, preorder_price_max: 360 },
];

beforeEach(() => {
  db.sellers = [{ id: "s1", is_active: true, opens_at: "06:00", closes_at: "14:00", accepts_preorder: true, preorder_cutoff_time: "22:00" }];
  db.fish_listings = [{ id: "l1", seller_id: "s1", species: "pomfret", weight_avail: 5, is_available: true, is_preorder_enabled: true, pricing_options: OPTS }];
  db.orders = [];
});

const resolve = (pricing_option_id: string | null, rawQuantity: number, nowMs = SAME_DAY) =>
  resolveListingOrderLine(fake, { listing_id: "l1", pricing_option_id, rawQuantity, buyer_phone: "9876543210", nowMs });

describe("getListingOptionById", () => {
  it("unknown id is not found; no id / 'default' is the first option", () => {
    expect(getListingOptionById({ pricing_options: OPTS }, "opt_9")).toBeUndefined();
    expect(getListingOptionById({ pricing_options: OPTS }, "default")?.id).toBe("opt_0");
    expect(getListingOptionById({ pricing_options: OPTS }, null)?.id).toBe("opt_0");
    expect(getListingOptionById({ pricing_options: OPTS }, "opt_1")?.id).toBe("opt_1");
  });
  it("options stored without ids still resolve by opt_<index>", () => {
    const noIds = [{ price: 600, unit: "kg" }, { price: 320, unit: "kg", bundle_size: 0.5 }];
    expect(getListingOptionById({ pricing_options: noIds }, "opt_1")?.price).toBe(320);
  });
});

describe("resolveListingOrderLine: option_changed", () => {
  it("removed pack → 409 option_changed, not option 0", async () => {
    const r = await resolve("opt_9", 1);
    expect(r).toMatchObject({ ok: false, status: 409, code: "option_changed" });
  });

  it("legacy 'default' line still orders", async () => {
    const r = await resolve("default", 1);
    expect(r.ok && r.line.pricing_option_id).toBe("opt_0");
  });

  it("pre-order quantity that isn't whole packs → 409 option_changed", async () => {
    const r = await resolve("opt_1", 0.75, PREORDER);
    expect(r).toMatchObject({ ok: false, status: 409, code: "option_changed" });
  });

  it("pre-order in whole packs is charged the top of the range per pack", async () => {
    const r = await resolve("opt_1", 1, PREORDER);
    expect(r.ok && r.line.total_price).toBe(720);
  });

  it("named pack is never swapped for another that divides the quantity", async () => {
    db.fish_listings[0].pricing_options = [
      { id: "opt_a", label: "1 kg pack", price: 600, unit: "kg", bundle_size: 1 },
      { id: "opt_b", label: "Half kg", price: 320, unit: "kg", bundle_size: 0.5 },
    ];
    db.fish_listings[0].pricing_options[0].bundle_size = 2; // seller resized opt_a
    const r = await resolve("opt_a", 1);
    expect(r.ok).toBe(false);
  });
});
