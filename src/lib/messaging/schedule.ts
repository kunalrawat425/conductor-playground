/**
 * WhatsApp / push promo scheduler (founder rules, 24 Oct 2026). Pure: no I/O, all times IST.
 *
 * Journeys, rf2 templates:
 *  P  Tue 6:00 PM; Fri, Sat and Sun 8:30 AM (founder, 30 Oct): one promo chosen by stage.
 *     Cart → rf2_promo_cart, cart with only off-menu fish → rf2_cart_swap (a substitute from that
 *     seller's live menu), unpaid order → rf2_promo_unpaid, delivered before → rf2_order_again,
 *     else generic: Tue evening rf2_catch_preorder (pre-order for tomorrow); Fri/Sat/Sun mornings
 *     rf2_catch_prices when a Today slot is bookable ("order by" = last Today slot's end − 2 h,
 *     the checkout's own cutoff), else rf2_catch_preorder. Paid and awaiting delivery → none.
 *     Anti-spam (founder, 30 Oct): one per IST day and ≥ 72 h since the buyer's last marketing
 *     message (PROMO_KINDS, incl. old B1/B2 log rows), so a Tue 6 PM recipient (62.5 h) skips Fri and
 *     a Fri recipient skips Sat/Sun until the next Tue; none within 3 days of a delivery or
 *     after 30 days inactive.
 *     No promo within 48 h of an activity reminder (founder, 30 Oct), and none for 72 h after Meta
 *     blocked a promo to that buyer (per-user marketing limit: wait, don't retry).
 *  R  Activity reminders (founder, 30 Oct), once per action, 8 AM–9 PM, decideActivity():
 *     unpaid checkout + 30 min → rf2_unpaid · cart left + 1 h → rf2_cart_today / rf2_cart_preorder ·
 *     sign-up with no cart + 1 h → rf2_welcome. Highest only (unpaid > cart > sign-up); at most one
 *     cart/sign-up reminder a day; an action in quiet hours is reminded at 8 AM next day if still true.
 *     Channel: WhatsApp if opted in, else SMS (dispatch in lib/server/messaging.ts).
 * Order updates live elsewhere (notify-order-whatsapp.ts).
 *
 * "Order today" vs "pre-order" is never guessed from the buyer: it is what the checkout's own
 * picker (deliveryDaysAt) offers at the send time. classifyPlacementAtOrderTime alone is not
 * enough: at 16:30 Fishtokri is "open" but has no Today slot left (slots must end 2 h out).
 */
import { arrivingByLabel, deliveryDaysAt, slotLabel, slotTimeLabel, SLOT_LEAD_MINUTES, type SlotSeller } from "../delivery-slots";
import { haversineKm } from "../order-pricing";
import { timeLabel } from "../order-timing";

export const DAY_START = 8 * 60;        // no promos before 8:00
export const DAY_END = 21 * 60;         // quiet from 21:00
export const DUE_WINDOW_MIN = 120;      // a due message is still sent if the job runs up to 2 h late
/** IST weekday (0 Sun … 6 Sat) → promo send minute (founder, 30 Oct). */
export const PROMO_SLOTS: Record<number, number> = { 0: 8 * 60 + 30, 2: 18 * 60, 5: 8 * 60 + 30, 6: 8 * 60 + 30 }; // Tue 6 PM; Fri, Sat, Sun 8:30 AM (founder, 30 Oct)
export const PROMO_GAP_MS = 72 * 3_600_000; // ≥ 3 days since the buyer's last B1/B2/promo
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MS = 86_400_000;
const IST_MS = 5.5 * 3_600_000;
const THANE_WEST = { lat: 19.2045, lng: 72.97 };

export type MsgSeller = SlotSeller & {
  id: string; name: string; slug: string;
  lat?: number | string | null; lng?: number | string | null; delivery_rad?: number | string | null;
  menu?: string;                     // "Surmai · Pomfret · Bombil": its pre-order fish, for rf2_catch_preorder
  live?: MenuItem[];                 // its live listings (available or pre-order): rf2_cart_swap and the generic promo's photo
};
/** A live listing: name, first pricing option (price, label), listing photo, open for pre-order. */
export type MenuItem = { name: string; species?: string | null; price: number; label?: string | null; photo?: string | null; preorder?: boolean };
export type CartLine = { seller_id: string; name: string; species?: string | null; photo?: string | null; price?: number | null; on_menu: boolean; updated_at: string };
/** One of the buyer's orders: the fish, its seller and photo (the checkout's costliest item's). */
export type OrderLine = { id: string; seller_id: string; name: string; species?: string | null; photo?: string | null;
  created_at?: string; slot_start?: string | null; checkout?: string }; // unpaid: placed at, slot start, cart_id || id
export type BuyerState = {
  id: string;
  created_at: string;
  name: string;                      // first name for the greeting ("fish lover" when unknown)
  lat?: number | null; lng?: number | null;
  cart: CartLine[];
  last_order_at: string | null;      // latest real order (any status)
  open_order: boolean;               // paid and not finished/cancelled
  unpaid: OrderLine | null;          // latest order still waiting for payment
  unpaids?: OrderLine[];             // every checkout still waiting for payment (one per checkout), oldest first
  delivered: OrderLine | null;       // latest delivered order
  last_delivered_at: string | null;
  opted_out: boolean;                // whatsapp_opt_out_at set: no promos or reminders
  dnd?: boolean;                     // founder's do-not-message list: no promos or reminders on any channel
};
/** A message_log row. Rows without a status are treated as delivered (older callers/tests). */
export type SentLog = { kind: string; slot_date: string; created_at: string; status?: string; channel?: string; error?: string | null; dedupe_key?: string };
export type ActKind = "act_unpaid" | "act_cart" | "act_signup";
export type Kind = "B1" | "B2" | "promo" | ActKind;
export const PROMO_KINDS: string[] = ["B1", "B2", "promo"];
export const ACT_KINDS: string[] = ["act_unpaid", "act_cart", "act_signup"];
export const UNPAID_AFTER_MS = 30 * 60_000;      // founder, 30 Oct
export const CART_AFTER_MS = 60 * 60_000;
export const SIGNUP_AFTER_MS = 60 * 60_000;
export const ACT_PROMO_GAP_MS = 48 * 3_600_000;  // no promo within 2 days of an activity reminder
export const META_HOLD_MS = 72 * 3_600_000;      // Meta blocked a promo → none for 3 days
/** Reached the buyer (or may have): counts for gaps and caps. Failed / dry-run rows don't. */
export const isReal = (x: SentLog) => !x.status || ["sent", "delivered", "read"].includes(x.status);
/** Meta's per-user marketing limit ("restricted it for higher quality messaging", error 131049). */
export const metaBlocked = (x: SentLog) => x.status === "failed" && /restricted|131049|higher quality/i.test(String(x.error || ""));
export type PromoTemplate = "rf2_welcome" | "rf2_cart_today" | "rf2_cart_preorder" | "rf2_promo_cart" | "rf2_cart_swap" | "rf2_promo_unpaid" | "rf2_order_again" | "rf2_catch_preorder" | "rf2_catch_prices";
export type Decision = {
  kind: Kind;
  slot_date: string;
  due_ms: number;
  mode: "today" | "preorder";
  seller: MsgSeller;
  personal: boolean;                 // names their fish (cart, unpaid or last order), else generic
  items: string[];
  species: string | null;            // fish of the first item named
  photo: string | null;              // header picture: a seller's own listing photo or null, never stock (cart_swap: the substitute's; generic: catchPhoto)
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
export const inSendHours = (ms: number) => { const m = istMin(ms); return m >= DAY_START && m < DAY_END; };

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
const isDue = (now: number, due: number) => now >= due && now < due + DUE_WINDOW_MIN * 60_000;
const latestFirst = (lines: CartLine[]) => [...lines].sort((x, y) => Date.parse(y.updated_at) - Date.parse(x.updated_at));
const onMenuLines = (b: BuyerState) => latestFirst(b.cart.filter((l) => l.on_menu));
const offMenuLines = (b: BuyerState, sellerId: string) => latestFirst(b.cart.filter((l) => !l.on_menu && l.seller_id === sellerId));

/** Where the buyer is: cart (newer than any order) → cart with only off-menu fish → unpaid order → delivered before → generic. */
export type Stage = "cart" | "cart_swap" | "unpaid" | "again" | "generic";

/**
 * Header picture for every message (founder 30 Oct): the seller's own listing photo of the costliest
 * item; no photo on that listing → null (text-only), never a stock photo. Ties → the first line (latest).
 */
export function costliestPhoto(lines: { price?: number | null; photo?: string | null }[]): string | null {
  return [...lines].sort((x, y) => (Number(y.price) || 0) - (Number(x.price) || 0))[0]?.photo || null;
}

/**
 * Generic "today's / tomorrow's catch" picture (founder 30 Oct): the buyer's costliest cart item with
 * this seller (any age, on or off the menu; that item has no photo → null); no cart with them → the
 * costliest item WITH a photo on the menu the message is about (pre-order menu for rf2_catch_preorder).
 */
export function catchPhoto(b: BuyerState, seller: MsgSeller, preorderOnly: boolean): string | null {
  const mine = b.cart.filter((l) => l.seller_id === seller.id);
  if (mine.length) return costliestPhoto(mine);
  return costliestPhoto((seller.live ?? []).filter((m) => m.photo && (!preorderOnly || m.preorder)));
}

/** Substitute for a fish taken off the menu (founder 30 Oct): same species at the closest price, else the closest price; tie → cheaper. */
export function pickSubstitute(gone: { species?: string | null; price?: number | null }, live: MenuItem[]): MenuItem | null {
  const p = Number(gone.price) || 0;
  const sp = String(gone.species || "").toLowerCase();
  const same = sp ? live.filter((m) => String(m.species || "").toLowerCase() === sp) : [];
  return [...(same.length ? same : live)].sort((a, c) => Math.abs(a.price - p) - Math.abs(c.price - p) || a.price - c.price)[0] ?? null;
}

/**
 * The message for a stage: template, its variables in Meta's order, picture and link.
 * Null when nothing fits (the generic pre-order text only works when tomorrow is bookable).
 */
export function compose(kind: Kind, stage: Stage, due: number, b: BuyerState, seller: MsgSeller, offer: Offer): Decision | null {
  const lines: (CartLine | OrderLine)[] =
    stage === "cart" ? onMenuLines(b).filter((l) => l.seller_id === seller.id) : stage === "cart_swap" ? offMenuLines(b, seller.id) : stage === "unpaid" ? [b.unpaid!] : stage === "again" ? [b.delivered!] : [];
  const items = [...new Set(lines.map((l) => l.name))].slice(0, 3); // latest first
  const fish = items.join(" and ");
  const day = WEEKDAY[istDow(due)];
  const m = {
    kind, slot_date: istDate(due), due_ms: due, mode: offer.mode, seller, personal: items.length > 0, items,
    species: lines[0]?.species ?? null, when: offer.when, path: `/s/${seller.slug}`,
    photo: costliestPhoto(lines.filter((l) => l.seller_id === seller.id)), // never another seller's photo
  };
  if (stage === "cart_swap") {
    const sub = pickSubstitute(lines[0] ?? {}, seller.live ?? []);
    if (!sub) return null;
    const what = `${[sub.name, sub.label].filter(Boolean).join(" ")}, ₹${Math.round(sub.price).toLocaleString("en-IN")}`;
    return { ...m, template: "rf2_cart_swap", photo: sub.photo || null, body: [b.name, items.slice(0, 2).join(" and "), seller.name, what, offer.when] };
  }
  if (stage === "cart") {
    if (!items.length) return null;
    // Promo slot → rf2_promo_cart; the 1 h cart reminder (act_cart) → rf2_cart_today / rf2_cart_preorder.
    return kind === "promo"
      ? { ...m, template: "rf2_promo_cart", body: [day, b.name, fish, seller.name, offer.when] }
      : { ...m, template: offer.mode === "today" ? "rf2_cart_today" : "rf2_cart_preorder", body: [b.name, fish, seller.name, offer.when] };
  }
  if (stage === "unpaid") return { ...m, template: "rf2_promo_unpaid", body: [day, b.name, fish, offer.when], path: `/track/${b.unpaid!.id}` };
  if (stage === "again") return { ...m, template: "rf2_order_again", body: [b.name, fish, seller.name, offer.when] };
  // Morning slot (Fri/Sat/Sun 8:30) with a Today slot bookable: "Today's fresh catch is in … Order by 4 PM".
  if (offer.mode === "today" && offer.by && seller.menu && istMin(due) < 12 * 60) {
    return { ...m, template: "rf2_catch_prices", photo: catchPhoto(b, seller, false), body: [b.name, day, seller.menu, offer.by, offer.when], path: "/shop" };
  }
  // "Tomorrow morning's fresh catch is open for pre-order".
  if (offer.mode !== "preorder" || offer.date !== addDays(istDate(due), 1) || !seller.menu) return null;
  return { ...m, template: "rf2_catch_preorder", photo: catchPhoto(b, seller, true), body: [b.name, day, seller.menu, timeLabel(seller.preorder_cutoff_time) || "tonight", offer.when], path: "/shop" };
}

/** Decide the one promo (if any) this buyer should get in the job run at `now`. */
export function decide(now: number, b: BuyerState, sellers: MsgSeller[], history: SentLog[]): Decision | Skip {
  if (b.dnd) return { skip: "do not message" };
  if (b.opted_out) return { skip: "opted out" };
  if (b.open_order) return { skip: "open order" };
  if (!inSendHours(now)) return { skip: "quiet hours" };
  const today = istDate(now);
  const real = history.filter(isReal);
  if (real.some((x) => x.slot_date === today && (PROMO_KINDS.includes(x.kind) || ACT_KINDS.includes(x.kind)))) {
    return { skip: "already messaged today" };
  }
  // Founder 30 Oct: an activity reminder in the last 2 days → no promo; Meta blocked a promo → wait 3 days.
  if (real.some((x) => ACT_KINDS.includes(x.kind) && now - Date.parse(x.created_at) < ACT_PROMO_GAP_MS)) return { skip: "activity reminder <48h" };
  if (history.some((x) => metaBlocked(x) && PROMO_KINDS.includes(x.kind) && now - Date.parse(x.created_at) < META_HOLD_MS)) return { skip: "meta limit: waiting" };
  const cartMs = lastCartMs(b);
  const orderMs = b.last_order_at ? Date.parse(b.last_order_at) : 0;
  const hasCart = b.cart.length > 0 && cartMs > orderMs && now - cartMs <= 7 * DAY_MS;
  // Cart with nothing left on the menu: the latest off-menu line's seller, if known and it has live fish.
  const gone = hasCart ? latestFirst(b.cart.filter((l) => !l.on_menu)).find((l) => sellers.some((s) => s.id === l.seller_id)) : undefined;
  const swap = gone && sellers.find((s) => s.id === gone.seller_id)?.live?.length ? gone.seller_id : null;
  const stage: Stage = hasCart && onMenuLines(b).length ? "cart" : swap ? "cart_swap" : b.unpaid ? "unpaid" : b.delivered ? "again" : "generic";
  // The seller the message is about: the cart's, else the order's, else the nearest one.
  const orderSeller = stage === "cart_swap" ? swap : stage === "unpaid" ? b.unpaid!.seller_id : stage === "again" ? b.delivered!.seller_id : null;
  const seller = orderSeller ? sellers.find((s) => s.id === orderSeller) ?? null : pickSeller(b, sellers);
  if (!seller) return { skip: "no seller delivers to them" };

  // ── P: Tue 6 PM, Fri/Sat/Sun 8:30 AM, one promo by stage ──
  const lastActive = Math.max(Date.parse(b.created_at), cartMs, orderMs);
  const deliveredMs = b.last_delivered_at ? Date.parse(b.last_delivered_at) : 0;
  // No spam (founder 30 Oct): ≥ 72 h since the last marketing message (old B1/B2 rows count too).
  const spam = real.some((x) => PROMO_KINDS.includes(x.kind) && now - Date.parse(x.created_at) < PROMO_GAP_MS);
  const slot = PROMO_SLOTS[istDow(now)];
  if (slot == null || now - lastActive > 30 * DAY_MS || now - deliveredMs < 3 * DAY_MS || spam) return { skip: "nothing due" };
  const due = atIST(today, slot);
  if (!isDue(now, due)) return { skip: "nothing due" };
  // At send time the offer is re-read: what the message promises is what checkout offers now.
  const offer = offerAt(seller, now);
  return (offer && compose("promo", stage, due, b, seller, offer)) || { skip: "nothing due" };
}

// ── R: activity reminders ──
/** 8:00 IST at or after `ms` (same day when before 8:00, else the next day). */
const nextMorning = (ms: number) => istMin(ms) < DAY_START ? atIST(istDate(ms), DAY_START) : atIST(addDays(istDate(ms), 1), DAY_START);
/**
 * May a reminder due at `due` go at `now`? Within 2 h of being due, inside 8 AM–9 PM. Due in quiet
 * hours, or its 2 h ran past 9 PM → 8:00–9:00 next morning instead (the caller re-checks it's still true, ≤ 24 h old).
 */
export function reminderWindow(due: number, now: number): boolean {
  if (now < due || !inSendHours(now)) return false;
  const deferred = !inSendHours(due);
  const start = deferred ? nextMorning(due) : due;
  const len = (deferred ? 60 : DUE_WINDOW_MIN) * 60_000;
  if (now >= start && now < start + len) return true;
  // Due late evening and the 2 h ran past 9 PM: one more chance 8–9 AM next day.
  const nm = nextMorning(start);
  return !deferred && start + len > atIST(istDate(start), DAY_END) && now >= nm && now < nm + 60 * 60_000;
}

export type UnpaidDue = { kind: "act_unpaid"; dedupe_key: string; slot_date: string; due_ms: number; order_id: string };
export type ActDecision = Decision & { dedupe_key: string; sms: { key: "CART" | "SIGNUP"; vars: string[] } };

/**
 * The one activity reminder (if any) due for this buyer at `now`. Pure.
 * Unpaid > cart > sign-up; each action once (dedupe_key); cart/sign-up at most one a day.
 * `history`: this buyer's message_log rows (any status; failed ones count as "already reminded").
 */
export function decideActivity(now: number, b: BuyerState, sellers: MsgSeller[], history: SentLog[]): UnpaidDue | ActDecision | Skip {
  if (b.dnd) return { skip: "do not message" };
  if (b.opted_out) return { skip: "opted out" };
  if (!inSendHours(now)) return { skip: "quiet hours" };
  const done = (key: string) => history.some((x) => x.dedupe_key?.startsWith(`${key}:`) && x.status !== "dry_run");
  const today = istDate(now);

  // 1. Unpaid checkout: 30 min after it was placed, while its slot is still ahead (≤ 24 h). Each checkout once.
  for (const u of b.unpaids ?? (b.unpaid ? [b.unpaid] : [])) {
    if (!u.created_at) continue;
    const due = Date.parse(u.created_at) + UNPAID_AFTER_MS;
    const key = `act_unpaid:${u.checkout || u.id}`;
    const slotAhead = !u.slot_start || Date.parse(u.slot_start) > now;
    if (now - Date.parse(u.created_at) < DAY_MS && slotAhead && !done(key) && reminderWindow(due, now)) {
      return { kind: "act_unpaid", dedupe_key: key, slot_date: today, due_ms: due, order_id: u.id };
    }
  }
  if (b.open_order) return { skip: "open order" };
  const capped = history.some((x) => isReal(x) && x.slot_date === today && (x.kind === "act_cart" || x.kind === "act_signup"));

  // 2. Cart left: 1 h after the last change, no order since, something still on the menu (≤ 24 h).
  const cartMs = lastCartMs(b);
  const orderMs = b.last_order_at ? Date.parse(b.last_order_at) : 0;
  if (b.cart.length && cartMs > orderMs && now - cartMs < DAY_MS && onMenuLines(b).length) {
    const key = `act_cart:${b.id}:${istDate(cartMs)}`;
    const seller = pickSeller({ ...b, cart: onMenuLines(b) }, sellers);
    if (capped || done(key)) return { skip: "cart already reminded" };
    if (!seller) return { skip: "no seller delivers to them" };
    if (!reminderWindow(cartMs + CART_AFTER_MS, now)) return { skip: "nothing due" };
    const offer = offerAt(seller, now);
    const d = offer && cartMessage(now, b, seller, offer);
    return d ? { ...d, dedupe_key: key } : { skip: "nothing due" };
  }

  // 3. Signed up, nothing in the cart, never ordered: 1 h after sign-up (≤ 24 h).
  const signed = Date.parse(b.created_at);
  if (!b.cart.length && !b.last_order_at && now - signed < DAY_MS) {
    const key = `act_signup:${b.id}`;
    if (capped || done(key)) return { skip: "sign-up already reminded" };
    if (!reminderWindow(signed + SIGNUP_AFTER_MS, now)) return { skip: "nothing due" };
    const seller = pickSeller(b, sellers);
    const offer = seller && offerAt(seller, now);
    if (!seller || !offer) return { skip: "no seller delivers to them" };
    return { ...signupMessage(now, b, seller, offer), dedupe_key: key };
  }
  return { skip: "nothing due" };
}

/** The 1 h cart reminder for a buyer with something on the menu in their cart (null if nothing fits). */
export function cartMessage(now: number, b: BuyerState, seller: MsgSeller, offer: Offer): Omit<ActDecision, "dedupe_key"> | null {
  const d = compose("act_cart", "cart", now, b, seller, offer);
  return d && { ...d, sms: { key: "CART", vars: [b.name, d.items.join(" and "), seller.name, offer.when] } };
}

/** The 1 h welcome: "a local seller near you…", next slot, today's catch photo. */
export function signupMessage(now: number, b: BuyerState, seller: MsgSeller, offer: Offer): Omit<ActDecision, "dedupe_key"> {
  return {
    kind: "act_signup", slot_date: istDate(now), due_ms: now, mode: offer.mode, seller, personal: false, items: [], species: null,
    photo: catchPhoto(b, seller, false), when: offer.when, template: "rf2_welcome", body: [b.name, "you", offer.when], path: "/shop",
    sms: { key: "SIGNUP", vars: [b.name, seller.name] },
  };
}
