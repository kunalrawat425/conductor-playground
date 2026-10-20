import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * /api/buyer/cart carries the cart mode (same-day / pre-order, migration 079) and keeps
 * working on a database without placement_kind (deploy before migration).
 */

type Row = Record<string, any>;
let hasMode = true; // is migration 079 applied?
let rows: Row[] = [];
const listings: Row[] = [{ id: "l1", seller_id: "s1" }];

const missingCol = { code: "42703", message: "column buyer_cart.placement_kind does not exist" };
function query(table: string) {
  const filters: [string, (r: Row) => boolean][] = [];
  let op: "select" | "upsert" | "delete" = "select";
  let cols = "";
  let payload: Row = {};
  let conflict: string[] = [];
  const src = () => (table === "buyer_cart" ? rows : listings);
  const err = () => {
    if (table !== "buyer_cart" || hasMode) return null;
    if (op === "upsert" && "placement_kind" in payload) return { code: "PGRST204", message: "Could not find the 'placement_kind' column" };
    if (op === "upsert" && conflict.includes("placement_kind")) return { code: "42P10", message: "no unique constraint" };
    if (cols.includes("placement_kind") || filters.some(([k]) => k === "placement_kind")) return missingCol;
    return null;
  };
  const run = () => {
    const e = err();
    if (e) return { data: null, error: e };
    const hit = src().filter((r) => filters.every(([, f]) => f(r)));
    if (op === "delete") { rows = rows.filter((r) => !hit.includes(r)); return { data: hit, error: null }; }
    if (op === "upsert") {
      const row = hasMode ? { placement_kind: "same_day", ...payload } : payload;
      const i = rows.findIndex((r) => conflict.every((k) => r[k] === row[k]));
      if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push(row);
      return { data: row, error: null };
    }
    return { data: hit, error: null };
  };
  const q: any = {
    select: (c = "") => { cols = op === "select" ? c : cols; return q; },
    upsert: (p: Row, o: { onConflict: string }) => { op = "upsert"; payload = p; conflict = o.onConflict.split(","); return q; },
    delete: () => { op = "delete"; return q; },
    eq: (k: string, v: any) => { filters.push([k, (r) => r[k] === v]); return q; },
    in: (k: string, vs: any[]) => { filters.push([k, (r) => vs.includes(r[k])]); return q; },
    order: () => q,
    single: async () => run(),
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return q;
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: (t: string) => query(t) }) }));
vi.mock("../../src/lib/server/session", () => ({ requireBuyer: () => null }));
const { GET, POST, DELETE } = await import("../../src/pages/api/buyer/cart");

const post = (body: Row) =>
  POST({ request: new Request("http://x/api/buyer/cart", { method: "POST", body: JSON.stringify({ buyer_id: "b1", listing_id: "l1", pricing_option_id: "opt_0", qty: 1, qty_unit: "kg", price_snapshot: 600, ...body }) }) } as any);
const del = (qs: string) => DELETE({ url: new URL(`http://x/api/buyer/cart?buyer_id=b1&${qs}`), request: new Request("http://x") } as any);
const get = async () => (await (await GET({ url: new URL("http://x/api/buyer/cart?buyer_id=b1"), request: new Request("http://x") } as any)).json()).items;

beforeEach(() => {
  hasMode = true;
  rows = [];
});

describe("with migration 079", () => {
  it("same listing + option is one row per mode", async () => {
    expect((await post({})).status).toBe(200);
    expect((await post({ placement_kind: "preorder", price_snapshot: 700 })).status).toBe(200);
    expect((await post({ placement_kind: "preorder", qty: 2 })).status).toBe(200);
    expect(rows.map((r) => [r.placement_kind, r.qty])).toEqual([["same_day", 1], ["preorder", 2]]);
    expect((await get()).map((i: Row) => i.placement_kind)).toEqual(["same_day", "preorder"]);
  });

  it("DELETE with placement_kind removes only that cart's line / seller cart", async () => {
    await post({});
    await post({ placement_kind: "preorder" });
    expect((await del("listing_id=l1&pricing_option_id=opt_0&placement_kind=preorder")).status).toBe(200);
    expect(rows.map((r) => r.placement_kind)).toEqual(["same_day"]);
    await post({ placement_kind: "preorder" });
    await del("seller_id=s1&placement_kind=same_day");
    expect(rows.map((r) => r.placement_kind)).toEqual(["preorder"]);
    await post({});
    await del("seller_id=s1"); // no mode: both carts (switching seller)
    expect(rows).toEqual([]);
  });
});

describe("before migration 079 (no placement_kind column)", () => {
  it("POST / GET / DELETE fall back to the 3-column behaviour", async () => {
    hasMode = false;
    expect((await post({ placement_kind: "preorder" })).status).toBe(200);
    expect(rows).toEqual([expect.not.objectContaining({ placement_kind: expect.anything() })]);
    const items = await get();
    expect(items).toHaveLength(1);
    expect(items[0].placement_kind).toBeNull(); // unknown: client keeps its local mode
    expect((await del("listing_id=l1&pricing_option_id=opt_0&placement_kind=preorder")).status).toBe(200);
    expect(rows).toEqual([]);
    await post({});
    expect((await del("seller_id=s1&placement_kind=same_day")).status).toBe(200);
    expect(rows).toEqual([]);
  });
});
