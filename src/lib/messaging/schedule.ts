/**
 * WhatsApp / push promo scheduler (founder rules, 24 Oct 2026). Pure: no I/O, all times IST.
 *
 * Journeys (one promo per buyer per IST day, priority B > promo), rf2 templates:
 *  B  cart changed, no order since: B1 = last change +1 h (else next day at the seller's slot),
 *     B2 = the day after B1 at the seller's slot. rf2_cart_today / rf2_cart_preorder.
 *  P  Tue, Thu, Fri 7:30 PM and Sat 9:30 AM (founder, 30 Oct): one promo chosen by stage.
 *     Cart → rf2_promo_cart, unpaid order → rf2_promo_unpaid, delivered before → rf2_order_again,
 *     else generic: evenings rf2_catch_preorder (pre-order for tomorrow); Sat 9:30 AM
 *     rf2_catch_prices when a Today slot is bookable ("order by" = last Today slot's end − 2 h,
 *     the checkout's own cutoff), else rf2_catch_preorder. Paid and awaiting delivery → none.
 *     Anti-spam (founder, 30 Oct): one of B1/B2/promo per IST day; a promo needs ≥ 20 h since
 *     the buyer's last B1/B2/promo and < 3 of them in the last 7 days; none within 3 days of a
 *     delivery or after 30 days inactive. B1/B2 go first (a promo waits if one is due later that
 *     day) and are not held by the 20 h gap or the weekly cap.
 *  A  the welcome after sign-up (rf2_welcome / rf2_welcome_search) is ON HOLD (founder): not sent.
 *
 * "Order today" vs "pre-order" is never guessed from the buyer: it is what the checkout's own
 * picker (deliveryDaysAt) offers at the send time. classifyPlacementAtOrderTime alone is not
 * enough: at 16:30 Fishtokri is "open" but has no Today slot left (slots must end 2 h out).
 */
import { arrivingByLabel, deliveryDaysAt, slotLabel, slotTimeLabel, SLOT_LEAD_MINUTES, type SlotSeller } from "../delivery-slots";
import { haversineKm } from "../order-pricing";
import { timeLabel } from "../order-timing";

export const DAY_START = 8 * 60;        // no promos before 8:00
export const LAST_SEND = 20 * 60 + 30;  // latest due time we schedule (the 30-min job still catches it)
export const DAY_END = 21 * 60;         // quiet from 21:00
export const MORNING = 9 * 60 + 30;     // Clarity: adds/checkouts peak 10–11 AM
export const EVENING = 19 * 60;         // Clarity: adds/checkouts 6–7 PM; after Fishtokri's 6 PM close
export const DUE_WINDOW_MIN = 120;      // a due message is still sent if the job runs up to 2 h late
/** IST weekday (0 Sun … 6 Sat) → promo send minute (founder, 30 Oct). */
export const PROMO_SLOTS: Record<number, number> = { 2: 19 * 60 + 30, 4: 19 * 60 + 30, 5: 19 * 60 + 30, 6: 9 * 60 + 30 };
export const PROMO_GAP_MS = 20 * 3_600_000; // ≥ 20 h since the buyer's last B1/B2/promo
export const PROMO_WEEK_MAX = 3;            // < 3 B1/B2/promo in the last 7 days
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MS = 86_400_000;
const IST_MS = 5.5 * 3_600_000;
const THANE_WEST = { lat: 19.2045, lng: 72.97 };

export type MsgSeller = SlotSeller & {
  id: string; name: string; slug: string;
  lat?: number | string | null; lng?: number | string | null; delivery_rad?: number | string | null;
  menu?: string;                     // "Surmai · Pomfret · Bombil": its pre-order fish, for rf2_catch_preorder
};
export type CartLine = { seller_id: string; name: string; species?: string | null; photo?: string | null; on_menu: boolean; updated_at: string };
/** One of the buyer's orders: the fish, its seller and photo. */
export type OrderLine = { id: string; seller_id: string; name: string; species?: string | null; photo?: string | null };
export type BuyerState = {
  id: string;
  created_at: string;
  name: string;                      // first name for the greeting ("fish lover" when unknown)
  lat?: number | null; lng?: number | null;
  cart: CartLine[];
  last_order_at: string | null;      // latest real order (any status)
  open_order: boolean;               // paid and not finished/cancelled
  unpaid: OrderLine | null;          // latest order still waiting for payment
  delivered: OrderLine | null;       // latest delivered order
  last_delivered_at: string | null;
  opted_out: boolean;                // whatsapp_opt_out_at set: no promos at all
};
export type SentLog = { kind: string; slot_date: string; created_at: string };
export type Kind = "B1" | "B2" | "promo";
export const PROMO_KINDS: string[] = ["B1", "B2", "promo"];
export type PromoTemplate = "rf2_cart_today" | "rf2_cart_preorder" | "rf2_promo_cart" | "rf2_promo_unpaid" | "rf2_order_again" | "rf2_catch_preorder" | "rf2_catch_prices";
export type Decision = {
  kind: Kind;
  slot_date: string;
  due_ms: number;
  mode: "today" | "preorder";
  seller: MsgSeller;
  personal: boolean;                 // names their fish (cart, unpaid or last order), else generic
  items: string[];
  species: string | null;            // fish of the first item named (its photo is the header picture)
  photo: string | null;              // that item's listing photo
  when: string;                      // "today, 4–6 PM" / "Sun 25 Oct, 9–11 AM": the first slot checkout offers
  template: PromoTemplate;
  body: string[];                    // the template's {{1}}, {{2}}… in Meta's order
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
export const inSendHours = (ms: number) => { const m = istMin(ms); return m >= DAY_START && m < DAY_END; };

/** "Next day, same clock time": an after-midnight sign-up's "next day" is that same morning. */
export function nextDayAt(fromMs: number, clockMin: number): number {
  const d = istDate(fromMs);
  return atIST(istMin(fromMs) >= DAY_START ? addDays(d, 1) : d, clampDay(clockMin));
}

// ── What the seller can sell at a moment (the checkout picker's own answer) ──
/** by (Today only): latest order time for a Today slot, "4 PM" = the last slot's end − SLOT_LEAD_MINUTES. */
export type Offer = { mode: "today" | "preorder"; date: string; when: string; by?: string };
export function offerAt(seller: SlotSeller, ms: number): Offer | null {
  const days = deliveryDaysAt(seller, ms);
  if (!seller.delivery_slots_enabled || days.length === 0) return null;
  const today = days.find((d) => d.kind === "same_day" && d.slots.length > 0);
  if (today) {
    const lastEnd = Date.parse(today.slots[today.slots.length - 1].end);
    return { mode: "today", date: today.date, when: `today, ${slotTimeLabel(today.slots[0].start, today.slots[0].end)}`,
      by: arrivingByLabel(new Date(lastEnd - SLOT_LEAD_MINUTES * 60_000).toISOString()) };
  }
  const pre = days.find((d) => d.kind === "preorder" && d.slots.length > 0);
  return pre ? { mode: "preorder", date: pre.date, when: slotLabel(pre.slots[0].start, pre.slots[0].end) } : null;
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
const onMenuLines = (b: BuyerState) => b.cart.filter((l) => l.on_menu).sort((x, y) => Date.parse(y.updated_at) - Date.parse(x.updated_at));

/** Where the buyer is: cart (newer than any order) → unpaid order → delivered before → generic. */
export type Stage = "cart" | "unpaid" | "again" | "generic";

/**
 * The message for a stage: template, its variables in Meta's order, picture and link.
 * Null when nothing fits (the generic pre-order text only works when tomorrow is bookable).
 */
export function compose(kind: Kind, stage: Stage, due: number, b: BuyerState, seller: MsgSeller, offer: Offer): Decision | null {
  const lines: { name: string; species?: string | null; photo?: string | null }[] =
    stage === "cart" ? onMenuLines(b) : stage === "unpaid" ? [b.unpaid!] : stage === "again" ? [b.delivered!] : [];
  const items = [...new Set(lines.map((l) => l.name))].slice(0, 3); // latest first
  const fish = items.join(" and ");
  const day = WEEKDAY[istDow(due)];
  const m = {
    kind, slot_date: istDate(due), due_ms: due, mode: offer.mode, seller, personal: items.length > 0, items,
    species: lines[0]?.species ?? null, photo: lines[0]?.photo ?? null, when: offer.when, path: `/s/${seller.slug}`,
  };
  if (stage === "cart") {
    if (!items.length) return null;
    return kind === "promo"
      ? { ...m, template: "rf2_promo_cart", body: [day, b.name, fish, seller.name, offer.when] }
      : { ...m, template: offer.mode === "today" ? "rf2_cart_today" : "rf2_cart_preorder", body: [b.name, fish, seller.name, offer.when] };
  }
  if (stage === "unpaid") return { ...m, template: "rf2_promo_unpaid", body: [day, b.name, fish, offer.when], path: `/track/${b.unpaid!.id}` };
  if (stage === "again") return { ...m, template: "rf2_order_again", body: [b.name, fish, seller.name, offer.when] };
  // Morning slot (Sat 9:30) with a Today slot bookable: "Today's fresh catch is in … Order by 4 PM".
  if (offer.mode === "today" && offer.by && seller.menu && istMin(due) < 12 * 60) {
    return { ...m, template: "rf2_catch_prices", body: [b.name, day, seller.menu, offer.by, offer.when], path: "/shop" };
  }
  // "Tomorrow morning's fresh catch is open for pre-order".
  if (offer.mode !== "preorder" || offer.date !== addDays(istDate(due), 1) || !seller.menu) return null;
  return { ...m, template: "rf2_catch_preorder", body: [b.name, day, seller.menu, timeLabel(seller.preorder_cutoff_time) || "tonight", offer.when], path: "/shop" };
}

/** Decide the one promo (if any) this buyer should get in the job run at `now`. */
export function decide(now: number, b: BuyerState, sellers: MsgSeller[], history: SentLog[]): Decision | Skip {
  if (b.opted_out) return { skip: "opted out" };
  if (b.open_order) return { skip: "open order" };
  if (!inSendHours(now)) return { skip: "quiet hours" };
  const today = istDate(now);
  if (history.some((x) => x.slot_date === today && PROMO_KINDS.includes(x.kind))) {
    return { skip: "already messaged today" };
  }
  const cartMs = lastCartMs(b);
  const orderMs = b.last_order_at ? Date.parse(b.last_order_at) : 0;
  const hasCart = b.cart.length > 0 && cartMs > orderMs && now - cartMs <= 7 * DAY_MS;
  const stage: Stage = hasCart && onMenuLines(b).length ? "cart" : b.unpaid ? "unpaid" : b.delivered ? "again" : "generic";
  // The seller the message is about: the cart's, else the order's, else the nearest one.
  const orderSeller = stage === "unpaid" ? b.unpaid!.seller_id : stage === "again" ? b.delivered!.seller_id : null;
  const seller = orderSeller ? sellers.find((s) => s.id === orderSeller) ?? null : pickSeller(b, sellers);
  if (!seller) return { skip: "no seller delivers to them" };

  // At send time the offer is re-read: what the message promises is what checkout offers now.
  const tryDue = (kind: Kind, due: number | null) => {
    if (due == null || !isDue(now, due)) return null;
    const offer = offerAt(seller, now);
    return offer ? compose(kind, stage, due, b, seller, offer) : null;
  };

  // ── B: cart ──
  let bLaterToday = false; // a B1/B2 is due later today: the promo waits for it (B goes first)
  if (stage === "cart") {
    const b1 = sentSince(history, "B1", cartMs);
    let kind: Kind | null = null, due: number | null = null;
    if (!b1) {
      const plus1h = cartMs + 3_600_000;
      kind = "B1";
      due = istMin(plus1h) >= DAY_START && istMin(plus1h) <= LAST_SEND && istDate(plus1h) === istDate(cartMs)
        ? plus1h
        : sellerSlot(seller, istDate(nextDayAt(cartMs, 0)))?.ms ?? null;
    } else if (!sentSince(history, "B2", cartMs)) {
      kind = "B2";
      due = sellerSlot(seller, addDays(b1.slot_date, 1))?.ms ?? null;
    }
    if (kind) {
      const d = tryDue(kind, due);
      if (d) return d;
      bLaterToday = due != null && now < due && istDate(due) === today;
    }
  }

  // ── P: Tue/Thu/Fri 7:30 PM, Sat 9:30 AM, one promo by stage ──
  const lastActive = Math.max(Date.parse(b.created_at), cartMs, orderMs);
  const deliveredMs = b.last_delivered_at ? Date.parse(b.last_delivered_at) : 0;
  // No spam (founder 30 Oct): ≥ 20 h since the last B1/B2/promo, fewer than 3 in the last 7 days.
  const ages = history.filter((x) => PROMO_KINDS.includes(x.kind)).map((x) => now - Date.parse(x.created_at));
  const spam = ages.some((a) => a < PROMO_GAP_MS) || ages.filter((a) => a < 7 * DAY_MS).length >= PROMO_WEEK_MAX;
  const slot = PROMO_SLOTS[istDow(now)];
  if (slot != null && !bLaterToday && now - lastActive <= 30 * DAY_MS && now - deliveredMs >= 3 * DAY_MS && !spam) {
    const d = tryDue("promo", atIST(today, slot));
    if (d) return d;
  }
  return { skip: "nothing due" };
}
