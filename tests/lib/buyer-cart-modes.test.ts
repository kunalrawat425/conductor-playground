import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * src/lib/cart.ts: separate same-day / pre-order carts, and live validation
 * (latest price, out of stock, pack removed or changed) for the mode the buyer is in.
 */

const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const Cart = await import("../../src/lib/cart");

const IST = 5.5 * 3600_000;
const line = (over: Record<string, any> = {}) => ({
  listing_id: "l1", seller_id: "s1", seller_name: "Sea", name: "Pomfret", qty_unit: "kg",
  price: 600, pricing_option_id: "opt_0", pricing_label: "kg", qty: 1, bundle_size: 1, ...over,
});
const live = (over: Record<string, any> = {}) => ({
  id: "l1", seller_id: "s1", is_available: true, weight_avail: 10, is_order_paused: false,
  is_preorder_enabled: true, deleted_at: null,
  pricing_options: [
    { id: "opt_0", price: 600, unit: "kg", bundle_size: 1, preorder_price_min: 500, preorder_price_max: 700 },
    { id: "opt_1", price: 320, unit: "kg", bundle_size: 0.5 },
  ],
  ...over,
});
function serve(listings: any[]) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ listings })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", fakeStorage);
  Cart.setCartMode(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("separate carts per mode", () => {
  it("the same listing sits in both carts, each mode sees only its own", () => {
    Cart.addItem(line());
    Cart.addItem(line({ mode: "preorder", price: 700 }));
    expect(Object.keys(Cart.getCart(null))).toHaveLength(2);
    expect(Object.values(Cart.getCart("same_day")).map((i) => i.price)).toEqual([600]);
    expect(Object.values(Cart.getCart("preorder")).map((i) => i.price)).toEqual([700]);
  });

  it("setCartMode pins groupBySeller / clearCart; the other cart is kept", () => {
    Cart.addItem(line());
    Cart.addItem(line({ mode: "preorder", price: 700 }));
    Cart.setCartMode("preorder");
    expect(Cart.groupBySeller()[0].subtotal).toBe(700);
    Cart.clearCart({ sellerId: "s1" });
    Cart.setCartMode(null);
    expect(Object.values(Cart.getCart()).map((i) => Cart.lineMode(i))).toEqual(["same_day"]);
  });

  it("a line saved before modes existed is same-day", () => {
    store.set("v2_cart_global", JSON.stringify({ "l1:opt_0": line({ bundle_size: undefined }) }));
    expect(Object.keys(Cart.getCart("same_day"))).toEqual(["l1:opt_0"]);
    expect(Cart.getCart("preorder")).toEqual({});
    expect(Cart.lineKey(line({ mode: "preorder" }))).toBe("l1:opt_0|preorder");
  });

  it("adding from another seller clears both carts of the old seller", () => {
    Cart.addItem(line());
    Cart.addItem(line({ mode: "preorder" }));
    Cart.addItem(line({ listing_id: "l9", seller_id: "s2" }));
    expect(Object.values(Cart.getCart(null)).map((i) => i.seller_id)).toEqual(["s2"]);
  });
});

describe("validateCartLive", () => {
  it("removes and reports out of stock / delisted / paused, reprices the rest (old → new)", async () => {
    Cart.addItem(line());
    Cart.addItem(line({ listing_id: "l2", name: "Surmai" }));
    Cart.addItem(line({ listing_id: "l3", name: "Rawas" }));
    Cart.addItem(line({ listing_id: "l4", name: "Bangda" }));
    serve([
      live({ pricing_options: [{ id: "opt_0", price: 650, unit: "kg", bundle_size: 1 }] }),
      live({ id: "l2", weight_avail: 0.5 }),
      live({ id: "l3", deleted_at: "2026-10-01" }),
      live({ id: "l4", is_order_paused: true }),
    ]);
    const r = await Cart.validateCartLive("s1", "same_day");
    expect(r.removed.map((x) => [x.name, x.reason])).toEqual([
      ["Surmai", "Out of stock — removed"],
      ["Rawas", "No longer listed — removed"],
      ["Bangda", "Out of stock — removed"],
    ]);
    expect(r.priceChanges).toEqual([{ key: "l1:opt_0", name: "Pomfret", from: 600, to: 650 }]);
    expect(r.priceMessages[0]).toContain("₹600 → ₹650");
    expect(Object.values(Cart.getCart("same_day")).map((i) => [i.name, i.price])).toEqual([["Pomfret", 650]]);
    expect(Cart.getRemovedLines("s1", "same_day").map((x) => x.name)).toEqual(["Surmai", "Rawas", "Bangda"]);
  });

  it("pre-order: priced at the top of the range, today's stock ignored, not-enabled removed", async () => {
    Cart.addItem(line({ mode: "preorder", price: 600 }));
    Cart.addItem(line({ listing_id: "l2", name: "Surmai", mode: "preorder" }));
    serve([live({ weight_avail: 0, is_available: false }), live({ id: "l2", is_preorder_enabled: false })]);
    const r = await Cart.validateCartLive("s1", "preorder");
    expect(r.removed.map((x) => x.reason)).toEqual(["Not open for pre-order — removed"]);
    expect(Object.values(Cart.getCart("preorder")).map((i) => i.price)).toEqual([700]);
  });

  it("only touches the mode asked for", async () => {
    Cart.addItem(line({ mode: "preorder" }));
    const f = serve([live({ is_available: false })]);
    const r = await Cart.validateCartLive("s1", "same_day");
    expect(f).not.toHaveBeenCalled();
    expect(r.removed).toEqual([]);
    expect(Object.keys(Cart.getCart("preorder"))).toHaveLength(1);
  });

  it("pack removed or bundle size changed: dropped, never moved to the first option", async () => {
    Cart.addItem(line({ pricing_option_id: "opt_9", name: "Gone pack" }));
    Cart.addItem(line({ listing_id: "l2", pricing_option_id: "opt_1", bundle_size: 0.5, qty: 0.5, price: 640, name: "Half kg" }));
    // Older line without bundle_size: 0.75 kg is no longer whole 0.5 kg packs.
    Cart.addItem(line({ listing_id: "l3", pricing_option_id: "opt_1", bundle_size: undefined, qty: 0.75, price: 640, name: "Legacy" }));
    const changed = [{ id: "opt_0", price: 600, unit: "kg", bundle_size: 1 }, { id: "opt_1", price: 320, unit: "kg", bundle_size: 0.25 }];
    serve([live(), live({ id: "l2", pricing_options: changed }), live({ id: "l3" })]);
    const r = await Cart.validateCartLive("s1", "same_day");
    expect(r.removed.map((x) => [x.name, x.reason])).toEqual([
      ["Gone pack", "Pack size changed — add it again"],
      ["Half kg", "Pack size changed — add it again"],
      ["Legacy", "Pack size changed — add it again"],
    ]);
    expect(Cart.getCart(null)).toEqual({});
  });

  it("options without ids still match opt_<index>; 'default' means the first option", () => {
    const opts = { pricing_options: [{ price: 600, unit: "kg" }, { price: 320, unit: "kg", bundle_size: 0.5 }] };
    expect(Cart.checkLine(line({ pricing_option_id: "opt_1", bundle_size: 0.5, qty: 0.5 }) as any, live(opts), "same_day")).toEqual({ price: 640, bundle: 0.5 });
    expect(Cart.checkLine(line({ pricing_option_id: "default" }) as any, live(opts), "same_day")).toEqual({ price: 600, bundle: 1 });
  });

  it("no mode (cart sheet): each seller in the mode its hours give; the other cart is left alone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2024, 0, 15, 18, 0) - IST); // Mon 18:00 IST: closed, pre-order window
    try {
      Cart.addItem(line());
      Cart.addItem(line({ mode: "preorder", price: 1 }));
      const seller = { opens_at: "06:00", closes_at: "14:00", accepts_preorder: true, preorder_cutoff_time: "22:00" };
      serve([live({ seller, is_available: false })]);
      const r = await Cart.validateCartLive();
      expect(r.sellerModes).toEqual({ s1: "preorder" });
      expect(r.removed).toEqual([]);
      expect(Object.values(Cart.getCart(null)).map((i) => [Cart.lineMode(i), i.price])).toEqual([["same_day", 600], ["preorder", 700]]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("nextModeBoundaryMs", () => {
  const seller = { opens_at: "06:00", closes_at: "14:00", preorder_cutoff_time: "22:00" };
  const at = (h: number, m = 0) => Date.UTC(2024, 0, 15, h, m) - IST;
  it("is the next open / close / cutoff / IST midnight", () => {
    expect(Cart.nextModeBoundaryMs(seller, at(9))).toBe(at(14));
    expect(Cart.nextModeBoundaryMs(seller, at(14))).toBe(at(22));
    expect(Cart.nextModeBoundaryMs(seller, at(23))).toBe(at(24));
    expect(Cart.nextModeBoundaryMs({}, at(9))).toBe(at(24));
  });
  it("placementAt flips across the boundary", () => {
    const s = { ...seller, accepts_preorder: true };
    expect(Cart.placementAt(s, at(13, 59))).toBe("same_day");
    expect(Cart.placementAt(s, Cart.nextModeBoundaryMs(s, at(13, 59)))).toBe("preorder");
  });
});
