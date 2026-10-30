/**
 * Combos ("Silver Pomfret Combo") and the savings shown on the seller page and at checkout.
 * Display only: every number comes from the seller's own price and compare-at price.
 */

type Opt = {
  id?: string;
  label?: string;
  price: number;
  compare_at_price?: number | null;
  preorder_price_min?: number | null;
  preorder_price_max?: number | null;
  bundle_size?: number;
};
type Listing = { id: string; species?: string; description?: string | null; size_label?: string | null; pricing_options?: Opt[] | null };
type Line = { listing_id: string; pricing_option_id?: string; qty: number; price: number };

export function isComboListing(l: Partial<Listing> | null | undefined): boolean {
  return !!l && /\bcombo\b/i.test([l.species, l.size_label, l.description].filter(Boolean).join(" "));
}

/** "Combo · Silver pomfret 300–400 g cut, White prawns 10–20 pcs, Bombil fry cut 500 g" → 3 parts. */
export function comboParts(label: string | null | undefined): string[] {
  return String(label || "").replace(/^\s*combo\s*[·:-]\s*/i, "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * ₹ off one pack vs the was-price. A pre-order range (or a pre-order price other than the price) is
 * set after the catch, so it never has a "was"; a fixed pre-order price equal to the price does.
 */
export function dealSaving(o: Opt | null | undefined): number {
  if (!o) return 0;
  const lo = Number(o.preorder_price_min) || 0, hi = Number(o.preorder_price_max) || 0;
  if ((lo && hi && lo !== hi) || ((hi || lo) && (hi || lo) !== Number(o.price))) return 0;
  const was = Number(o.compare_at_price), now = Number(o.price);
  return now > 0 && was > now ? Math.round((was - now) * 100) / 100 : 0;
}

/** "Save N%": round((1 − price / compare_at) × 100). */
export function savePct(o: Opt | null | undefined): number {
  return dealSaving(o) ? Math.round((1 - Number(o!.price) / Number(o!.compare_at_price)) * 100) : 0;
}

/** The menu's option id for option n (same rule as the seller page's add buttons). */
export const optionKey = (o: Opt, n: number) => o.id || `opt_${n}`;

function lineOption(i: Line, l: Listing | undefined): Opt | undefined {
  const opts = l?.pricing_options || [];
  return opts.find((o, n) => optionKey(o, n) === i.pricing_option_id) || (opts.length === 1 ? opts[0] : undefined);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Savings for cart lines: Σ (compare_at − price) × packs. A line whose price no longer matches the
 * option (repriced since it was added) claims nothing. comboSaved = the part from combo listings.
 */
export function cartSavings(items: Line[], listings: Listing[]): { mrp: number; saved: number; comboSaved: number } {
  let mrp = 0, saved = 0, comboSaved = 0;
  for (const i of items) {
    const l = listings.find((x) => x.id === i.listing_id);
    const o = lineOption(i, l);
    const bs = Number(o?.bundle_size) > 0 ? Number(o!.bundle_size) : 1;
    const packs = i.qty / bs;
    const off = o && Math.abs(i.price * bs - Number(o.price)) < 0.01 ? dealSaving(o) * packs : 0;
    mrp += i.qty * i.price + off;
    saved += off;
    if (isComboListing(l)) comboSaved += off;
  }
  return { mrp: r2(mrp), saved: r2(saved), comboSaved: r2(comboSaved) };
}

export type BundleRow = { listing: Listing; opt: Opt; optId: string; saving: number; pct: number; parts: string[]; ribbon?: "popular" | "value" };
export type BundleGroup = { base: string; sizes: BundleRow[]; combos: BundleRow[] };

/** Pack weight in grams from its label: "200–300 g · Cut" → 250 (mid-point), "1 kg" → 1000, "½ kg" → 500; none → 0. */
export function gramsOf(label: string | null | undefined): number {
  const t = String(label || "").replace(/½/g, "0.5");
  const m = t.match(/(\d+(?:\.\d+)?)\s*(?:[–-]\s*(\d+(?:\.\d+)?))?\s*(kg|g)\b/i);
  if (!m) return 0;
  const mid = m[2] ? (Number(m[1]) + Number(m[2])) / 2 : Number(m[1]);
  return m[3].toLowerCase() === "kg" ? mid * 1000 : mid;
}

/** The size with the lowest ₹ per 100 g (BEST VALUE): needs 2+ sizes with a weight and one clear winner; else -1. */
export function bestValueIndex(opts: Opt[]): number {
  const per = opts.map((o) => { const g = gramsOf(o.label); return g && o.price > 0 ? o.price / g : Infinity; });
  const min = Math.min(...per);
  return per.filter((x) => x !== Infinity).length >= 2 && per.filter((x) => x === min).length === 1 ? per.indexOf(min) : -1;
}

/**
 * One card per base fish ("Silver Pomfret" from "Silver Pomfret Combo"): every size of the plain
 * fish (if the menu has it) plus the combos. Ribbons only with 2+ combos: MOST POPULAR = biggest ₹ saving,
 * BEST VALUE = most parts (a clear winner that isn't already MOST POPULAR).
 */
export function bundleGroups(listings: Listing[], nameOf: (l: Listing) => string = (l) => l.species || ""): BundleGroup[] {
  const groups = new Map<string, BundleGroup>();
  for (const l of listings) {
    if (!isComboListing(l)) continue;
    const base = nameOf(l).replace(/\bcombo\b/gi, "").replace(/\s+/g, " ").trim();
    if (!base) continue;
    const g = groups.get(base.toLowerCase()) || { base, sizes: [], combos: [] };
    groups.set(base.toLowerCase(), g);
    (l.pricing_options || []).forEach((o, n) => g.combos.push({
      listing: l, opt: o, optId: optionKey(o, n), saving: dealSaving(o), pct: savePct(o), parts: comboParts(o.label),
    }));
  }
  for (const [key, g] of groups) {
    const popular = g.combos.reduce((a, b) => (b.saving > a.saving ? b : a));
    if (g.combos.length >= 2) {
      if (popular.saving > 0) popular.ribbon = "popular";
      const most = Math.max(...g.combos.map((c) => c.parts.length));
      const value = g.combos.filter((c) => c.parts.length === most);
      if (value.length === 1 && !value[0].ribbon) value[0].ribbon = "value";
    }
    const plain = listings.find((l) => !isComboListing(l) && `${nameOf(l)} ${l.description || ""}`.toLowerCase().includes(key));
    g.sizes = (plain?.pricing_options || []).map((o, n) => ({
      listing: plain!, opt: o, optId: optionKey(o, n), saving: dealSaving(o), pct: savePct(o), parts: [],
    }));
    const best = bestValueIndex(g.sizes.map((r) => r.opt));
    if (best >= 0) g.sizes[best].ribbon = "value";
  }
  return [...groups.values()];
}
