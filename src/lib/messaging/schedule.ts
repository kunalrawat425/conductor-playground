/**
 * WhatsApp / push promo scheduler (founder rules, 24 Oct 2026). Pure: no I/O, all times IST.
 *
 * Journeys (one promo per buyer per IST day, priority B > A > weekend):
 *  A  signed up, never carted or ordered: A1 = sign-up +1 h (else next day, same clock time),
 *     A2 = the day after A1, same clock time.
 *  B  cart changed, no order since: B1 = last change +1 h (else next day at the seller's slot),
 *     B2 = the day after B1 at the seller's slot.
 *  W  weekly: Fri evening pre-order; Sat and Sun morning "order today", else evening pre-order.
 *
 * "Order today" vs "pre-order" is never guessed from the buyer: it is what the checkout's own
 * picker (deliveryDaysAt) offers at the send time. classifyPlacementAtOrderTime alone is not
 * enough: at 16:30 Fishtokri is "open" but has no Today slot left (slots must end 2 h out).
 */
import { deliveryDaysAt, slotLabel, type SlotSeller } from "../delivery-slots";
import { haversineKm } from "../order-pricing";

export const DAY_START = 8 * 60;        // no promos before 8:00
export const LAST_SEND = 20 * 60 + 30;  // latest due time we schedule (the 30-min job still catches it)
export const DAY_END = 21 * 60;         // quiet from 21:00
export const MORNING = 9 * 60 + 30;     // Clarity: adds/checkouts peak 10–11 AM
export const EVENING = 19 * 60;         // Clarity: adds/checkouts 6–7 PM; after Fishtokri's 6 PM close
export const DUE_WINDOW_MIN = 120;      // a due message is still sent if the job runs up to 2 h late
const DAY_MS = 86_400_000;
const IST_MS = 5.5 * 3_600_000;
const THANE_WEST = { lat: 19.2045, lng: 72.97 };

export type MsgSeller = SlotSeller & {
  id: string; name: string; slug: string;
  lat?: number | string | null; lng?: number | string | null; delivery_rad?: number | string | null;
};
export type CartLine = { seller_id: string; name: string; species?: string | null; on_menu: boolean; updated_at: string };
export type BuyerState = {
  id: string;
  created_at: string;
  lat?: number | null; lng?: number | null;
  cart: CartLine[];
  last_order_at: string | null;      // latest real order (any status)
  open_order: boolean;               // paid and not finished/cancelled
  last_delivered_at: string | null;
  opted_out: boolean;                // whatsapp_opt_out_at set: no promos at all
};
export type SentLog = { kind: string; slot_date: string; created_at: string };
export type Kind = "A1" | "A2" | "B1" | "B2" | "weekend";
export type Decision = {
  kind: Kind;
  slot_date: string;
  due_ms: number;
  mode: "today" | "preorder";
  seller: MsgSeller;
  personal: boolean;                 // cart text naming their fish, else generic
  items: string[];
  species: string | null;            // fish of the first item named (its photo is the header picture)
  when: string | null;               // "Sun 25 Oct, 9–11 AM" for pre-orders
  template: "rf_cart_today" | "rf_cart_preorder" | "rf_today_prices" | "rf_preorder_generic";
  path: string;                      // where the button lands (UTMs are added by /go/<id>)
};
export type Skip = { skip: string };

// ── IST time helpers ──
export const istDate = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);
export const istMin = (ms: number) => { const d = new Date(ms + IST_MS); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export const istDow = (ms: number) => new Date(ms + IST_MS).getUTCDay(); // 0 Sun … 6 Sat
export const atIST = (date: string, min: number) => Date.parse(`${date}T00:00:00+05:30`) + min * 60_000;
const addDays = (date: string, n: number) => istDate(atIST(date, 12 * 60) + n * DAY_MS);
const toMin = (t: string | null | undefined, dflt: number) => {
  const [h, m] = String(t || "").split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : dflt;
};
const clampDay = (min: number) => Math.min(LAST_SEND, Math.max(DAY_START, min));
const inSendHours = (ms: number) => { const m = istMin(ms); return m >= DAY_START && m < DAY_END; };

/** "Next day, same clock time": an after-midnight sign-up's "next day" is that same morning. */
export function nextDayAt(fromMs: number, clockMin: number): number {
  const d = istDate(fromMs);
  return atIST(istMin(fromMs) >= DAY_START ? addDays(d, 1) : d, clampDay(clockMin));
}

// ── What the seller can sell at a moment (the checkout picker's own answer) ──
export type Offer = { mode: "today" } | { mode: "preorder"; when: string };
export function offerAt(seller: SlotSeller, ms: number): Offer | null {
  const days = deliveryDaysAt(seller, ms);
  if (!seller.delivery_slots_enabled || days.length === 0) return null;
  const today = days.find((d) => d.kind === "same_day" && d.slots.length > 0);
  if (today) return { mode: "today" };
  const pre = days.find((d) => d.kind === "preorder" && d.slots.length > 0);
  return pre ? { mode: "preorder", when: slotLabel(pre.slots[0].start, pre.slots[0].end) } : null;
}

/** Morning slot = later of 9:30 and opens_at. Evening = 19:00, after the pre-order window opens,
 *  at least 2 h before its cutoff. Both kept inside 8:00–20:30. */
export function morningMin(s: MsgSeller) { return clampDay(Math.max(MORNING, toMin(s.opens_at, 0))); }
export function eveningMin(s: MsgSeller) {
  let m = Math.max(EVENING, toMin(s.preorder_opens_at, 0));
  const cut = toMin(s.preorder_cutoff_time, 24 * 60);
  const cutAbs = cut <= toMin(s.preorder_opens_at, 0) || cut < 12 * 60 ? cut + 24 * 60 : cut; // overnight cutoff
  m = Math.min(m, cutAbs - 120);
  return clampDay(m);
}

/** The seller's slot on `date`: morning if a Today order is possible then, else evening pre-order. */
export function sellerSlot(s: MsgSeller, date: string, want?: "morning" | "evening"): { ms: number; offer: Offer } | null {
  const tries: number[] = want === "evening" ? [eveningMin(s)] : want === "morning" ? [morningMin(s)] : [morningMin(s), eveningMin(s)];
  for (const min of tries) {
    const ms = atIST(date, min);
    const offer = offerAt(s, ms);
    if (!offer) continue;
    if (min === morningMin(s) && want !== "evening" && offer.mode !== "today") continue; // a morning slot is for "order today"
    return { ms, offer };
  }
  return null;
}

/** Seller for this buyer: their cart's seller; else the nearest seller that delivers to them;
 *  else (no location) the nearest to Thane West. */
export function pickSeller(b: BuyerState, sellers: MsgSeller[]): MsgSeller | null {
  const latest = [...b.cart].sort((x, y) => Date.parse(y.updated_at) - Date.parse(x.updated_at))[0];
  if (latest) return sellers.find((s) => s.id === latest.seller_id) ?? null;
  const at = b.lat != null && b.lng != null ? { lat: Number(b.lat), lng: Number(b.lng) } : THANE_WEST;
  const covering = sellers
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ s, d: haversineKm(at.lat, at.lng, Number(s.lat), Number(s.lng)) }))
    .filter(({ s, d }) => d <= (Number(s.delivery_rad) || 5))
    .sort((a, b2) => a.d - b2.d);
  return covering[0]?.s ?? null;
}

const lastCartMs = (b: BuyerState) => Math.max(0, ...b.cart.map((l) => Date.parse(l.updated_at)));
const sentSince = (h: SentLog[], kind: string, sinceMs: number) => h.find((x) => x.kind === kind && Date.parse(x.created_at) >= sinceMs);
const isDue = (now: number, due: number) => now >= due && now < due + DUE_WINDOW_MIN * 60_000;

/** Decide the one promo (if any) this buyer should get in the job run at `now`. */
export function decide(now: number, b: BuyerState, sellers: MsgSeller[], history: SentLog[]): Decision | Skip {
  if (b.opted_out) return { skip: "opted out" };
  if (b.open_order) return { skip: "open order" };
  if (!inSendHours(now)) return { skip: "quiet hours" };
  const today = istDate(now);
  if (history.some((x) => x.slot_date === today && ["A1", "A2", "B1", "B2", "weekend"].includes(x.kind))) {
    return { skip: "already messaged today" };
  }
  const seller = pickSeller(b, sellers);
  if (!seller) return { skip: "no seller delivers to them" };

  const cartMs = lastCartMs(b);
  const orderMs = b.last_order_at ? Date.parse(b.last_order_at) : 0;
  const hasCart = b.cart.length > 0 && cartMs > orderMs && now - cartMs <= 7 * DAY_MS;
  const onMenu = b.cart.filter((l) => l.on_menu).sort((x, y) => Date.parse(y.updated_at) - Date.parse(x.updated_at));
  const items = [...new Set(onMenu.map((l) => l.name))].slice(0, 3); // latest first
  const species = onMenu[0]?.species ?? null;

  const build = (kind: Kind, due: number, offer: Offer): Decision => {
    const personal = hasCart && items.length > 0;
    const mode = offer.mode;
    return {
      kind, slot_date: istDate(due), due_ms: due, mode, seller, personal, items, species: personal ? species : null,
      when: offer.mode === "preorder" ? offer.when : null,
      template: personal ? (mode === "today" ? "rf_cart_today" : "rf_cart_preorder") : (mode === "today" ? "rf_today_prices" : "rf_preorder_generic"),
      path: personal ? `/s/${seller.slug}` : "/shop",
    };
  };
  // At send time the offer is re-read: what the message promises is what checkout offers now.
  const tryDue = (kind: Kind, due: number | null) => {
    if (due == null || !isDue(now, due)) return null;
    const offer = offerAt(seller, now);
    return offer ? build(kind, due, offer) : null;
  };

  // ── B: cart ──
  if (hasCart) {
    const b1 = sentSince(history, "B1", cartMs);
    if (!b1) {
      const plus1h = cartMs + 3_600_000;
      const due = istMin(plus1h) >= DAY_START && istMin(plus1h) <= LAST_SEND && istDate(plus1h) === istDate(cartMs)
        ? plus1h
        : sellerSlot(seller, istDate(nextDayAt(cartMs, 0)))?.ms ?? null;
      const d = tryDue("B1", due);
      if (d) return d;
    } else if (!sentSince(history, "B2", cartMs)) {
      const d = tryDue("B2", sellerSlot(seller, addDays(b1.slot_date, 1))?.ms ?? null);
      if (d) return d;
    }
  }

  // ── A: signed up, never carted or ordered ──
  if (!hasCart && b.cart.length === 0 && !b.last_order_at) {
    const signup = Date.parse(b.created_at);
    const a1 = history.find((x) => x.kind === "A1");
    if (!a1) {
      const plus1h = signup + 3_600_000;
      const due = istMin(plus1h) >= DAY_START && istMin(plus1h) <= LAST_SEND && istDate(plus1h) === istDate(signup)
        ? plus1h
        : nextDayAt(signup, istMin(signup));
      const d = tryDue("A1", due);
      if (d) return d;
    } else if (!history.some((x) => x.kind === "A2")) {
      const d = tryDue("A2", atIST(addDays(a1.slot_date, 1), clampDay(istMin(signup))));
      if (d) return d;
    }
  }

  // ── Weekly weekend: Fri evening pre-order; Sat/Sun morning today, else evening pre-order ──
  const lastActive = Math.max(Date.parse(b.created_at), cartMs, orderMs);
  const deliveredMs = b.last_delivered_at ? Date.parse(b.last_delivered_at) : 0;
  const dow = istDow(now);
  if ([5, 6, 0].includes(dow) && now - lastActive <= 30 * DAY_MS && now - deliveredMs >= 3 * DAY_MS) {
    const slot = sellerSlot(seller, today, dow === 5 ? "evening" : undefined);
    if (slot && (dow !== 5 || slot.offer.mode === "preorder")) {
      const d = tryDue("weekend", slot.ms);
      if (d) return d;
    }
  }
  return { skip: "nothing due" };
}
