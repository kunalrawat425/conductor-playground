import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { checkLine } from "../../../lib/cart";
import { SLOT_SELLER_COLUMNS } from "../../../lib/delivery-slots";
import { sellerNameToSlug } from "../../../lib/seller-display";
import { PROMO_SMS_START, smsCapReached, cartMessage, decide, decideActivity, istDate, offerAt, pickSeller, promoSms, signupMessage, type BuyerState, type MsgSeller, type SentLog } from "../../../lib/messaging/schedule";
import { firstName, fishName } from "../../../lib/messaging/templates";
import { dispatch, smsFallbackDue, smsFallbackFor, type Dispatch } from "../../../lib/server/messaging";
import { againOrder, checkoutFish, loadCheckout, ORDER_SELECT, orderMessage, orderPhoto, orderSms, type OrderWaEvent } from "../../../lib/server/notify-order-whatsapp";
import { hasPaymentEvidence } from "../../../lib/server/reminders";
import { syncWatiStatuses } from "../../../lib/server/wati-status";
import { waNumber } from "../../../lib/server/whatsapp";

export const prerender = false;

const OPEN = ["paid", "confirmed", "out_for_delivery", "ready_for_pickup", "payment_required"];
const FOUNDER = "919870619974";
const env = (k: string) => (import.meta.env as any)[k] || process.env[k] || "";
const list = (k: string, dflt = "") => String(env(k) || dflt).split(",").map((x) => waNumber(x.trim())).filter(Boolean) as string[];
/** A listing's first pricing option: its price (pre-order: top of the range when no price) and label. */
const firstOpt = (l: any) => (Array.isArray(l?.pricing_options) ? l.pricing_options[0] : null);
const optPrice = (l: any) => Number(firstOpt(l)?.price) || Number(firstOpt(l)?.preorder_price_max) || 0;
/** The cart line's own option ("" / "default" = the first; ids default to opt_<index>, as checkLine). */
const lineOpt = (l: any, id: string) => (!id || id === "default" ? firstOpt(l) : (l?.pricing_options || []).find((o: any, i: number) => String(o?.id ?? `opt_${i}`) === id));
/** Every row of a query (PostgREST returns at most 1000 per request). Throws on a query error. */
async function all(q: () => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * GET|POST /api/cron/messaging — the buyer messaging engine (founder, 30 Oct). Runs every 10 min
 * (Supabase pg_cron, see migration 088) plus the Vercel slot crons as a backup; every send is
 * idempotent, and a live run skips while another holds cron_lock (migration 089). Auth: Bearer $CRON_SECRET.
 * Each run:
 *  1. reads delivered/read/failed back from Wati; a failed reminder or order update goes once by SMS;
 *  2. per buyer, at most one message: an activity reminder (unpaid 30 min, cart 1 h, sign-up 1 h),
 *     else a promo at its slot (Tue 6 PM, Fri/Sat/Sun 8:30 AM). Rules in lib/messaging/schedule.ts.
 * Channel: WhatsApp when opted in, else SMS (reminders only; promos are WhatsApp only).
 *   ?dry_run=1           report who would get what and why; nothing written or sent
 *   ?now=<ISO>           (dry run only) pretend it's this time
 *   ?promo_now=1         send the promo now instead of waiting for a slot (all other rules apply)
 *   ?promo_now=1&all=1   one-off "send to all opted-in": also skips the 72 h / 48 h gaps, Meta hold, inactive rules
 *   ?test_phone=<n>&test_kind=signup|cart|unpaid|promo|paid|confirmed|out_for_delivery|completed|cancelled[&channel=sms]
 *                        send one sample now to a test phone (MESSAGING_TEST_PHONES, default the founder)
 *   ?catchup_cart=<buyer id,…>  the cart reminder now for those buyers only (timing rules skipped; DND, sellers, empty carts never)
 * Sends happen only when MESSAGING_LIVE=true; otherwise every run is a report. Sellers never get these.
 */
export const GET: APIRoute = async (ctx) => {
  if (!env("CRON_SECRET")) return json({ error: "CRON_SECRET not configured" }, 503);
  if (ctx.request.headers.get("authorization") !== `Bearer ${env("CRON_SECRET")}`) return json({ error: "Unauthorized" }, 401);
  if (ctx.url.searchParams.get("dry_run") === "1" || env("MESSAGING_LIVE") !== "true") return run(ctx);
  // One live run at a time (migration 089): two overlapping runs each read the log before the other wrote.
  // A run that dies holds the lock 9 min at most.
  const sb = createClient(env("PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_KEY"));
  const { data: lock, error } = await sb.from("cron_lock").update({ until: new Date(Date.now() + 9 * 60_000).toISOString() })
    .eq("name", "messaging").lt("until", new Date().toISOString()).select("name");
  if (!lock?.length) return json({ skipped: "another run in progress", ...(error ? { error: error.message } : {}) });
  try {
    return await run(ctx);
  } finally {
    await sb.from("cron_lock").update({ until: new Date().toISOString() }).eq("name", "messaging");
  }
};

async function run({ url }: { url: URL }): Promise<Response> {
  const dry = url.searchParams.get("dry_run") === "1" || env("MESSAGING_LIVE") !== "true";
  const nowParam = url.searchParams.get("now");
  const promoNow = url.searchParams.get("promo_now") === "1"; // founder's extra promo run, rules unchanged
  const promoAll = promoNow && url.searchParams.get("all") === "1"; // one-off "send to all": skips the gaps and holds
  const now = dry && nowParam && !Number.isNaN(Date.parse(nowParam)) ? Date.parse(nowParam) : Date.now();
  const sb = createClient(env("PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_KEY"));

  // 1. Delivery status from Wati, then the SMS fallback for failed reminders / order updates.
  const sync: any = { checked: 0, updated: 0, stuck: 0, sms_fallback: [] as any[] };
  if (!dry) {
    // A row still "queued" after 10 min: the run died between logging and sending. Mark it failed
    // (with the reason) so it isn't silently lost. No SMS for it: the WhatsApp may have gone out.
    const { data: stuck } = await sb.from("message_log").update({ status: "failed", error: "stuck in queue: no send result", updated_at: new Date(now).toISOString() })
      .eq("status", "queued").lt("created_at", new Date(now - 10 * 60_000).toISOString()).gte("created_at", new Date(now - 6 * 3_600_000).toISOString()).select("id");
    sync.stuck = stuck?.length ?? 0;
    const s = await syncWatiStatuses(sb, now).catch((e: any) => ({ checked: 0, updated: 0, failed: [], error: e?.message }));
    Object.assign(sync, { checked: s.checked, updated: s.updated, error: (s as any).error });
    const { data: failed } = await sb.from("message_log").select("id, dedupe_key, kind, template, to_phone, slot_date, buyer_id, seller_id, order_id, link_path, payload, error, created_at")
      .eq("channel", "whatsapp").eq("status", "failed").gte("created_at", new Date(now - 6 * 3_600_000).toISOString()).not("payload", "is", null);
    // A reminder must still be true: the order still unpaid, no order since the cart reminder.
    const stillTrue = async (row: any) => {
      if (row.kind === "act_unpaid") {
        const { data: o } = await sb.from("orders").select("status, razorpay_payment_id, payment_verified_at, payment_screenshot_urls").eq("id", row.order_id).maybeSingle();
        return !!o && o.status === "pending_payment" && !hasPaymentEvidence(o);
      }
      if (row.kind === "act_cart") {
        const { data: later } = await sb.from("orders").select("id").eq("buyer_id", row.buyer_id).gt("created_at", row.created_at).limit(1);
        return !later?.length;
      }
      return true;
    };
    for (const row of failed || []) {
      if (!smsFallbackDue(row, now) || !(await stillTrue(row))) continue;
      const r = await smsFallbackFor(sb, row);
      if (r.status !== "duplicate" && r.status !== "no_channel") sync.sms_fallback.push({ buyer: `…${String(row.to_phone).slice(-4)}`, kind: row.kind, sent: r.status, error: r.error });
    }
  }

  const since = (days: number) => new Date(now - days * 86_400_000).toISOString();
  let sellerRows: any[], buyerRows: any[], cartRows: any[], orderRows: any[], logRows: any[], menuRows: any[];
  try {
    [sellerRows, buyerRows, cartRows, orderRows, logRows, menuRows] = await Promise.all([
      all(() => sb.from("sellers").select(`id, name, phone, lat, lng, delivery_rad, is_test, is_active, ${SLOT_SELLER_COLUMNS}`).order("id")),
      all(() => sb.from("buyers").select("id, phone, first_name, created_at, lat, lng, is_test, whatsapp_opt_in_at, whatsapp_opt_out_at, dnd_at").order("id")),
      all(() => sb.from("buyer_cart").select("id, buyer_id, pricing_option_id, placement_kind, qty, updated_at, listing:fish_listings(seller_id, species, description, photo_url, pricing_options, is_available, is_preorder_enabled, is_order_paused, weight_avail, deleted_at)").order("id")),
      all(() => sb.from("orders").select(`${ORDER_SELECT}, total_price, status, created_at, updated_at, cart_id, razorpay_payment_id, payment_verified_at, payment_screenshot_urls`).gte("created_at", since(60)).order("id")),
      // Last 8 days, any status: gaps (≤ 72 h) and caps count real sends only; "already reminded" counts failed ones too.
      all(() => sb.from("message_log").select("id, buyer_id, kind, slot_date, created_at, status, channel, error, dedupe_key").not("buyer_id", "is", null).gte("created_at", since(8)).order("id")),
      // Live listings only (available or pre-order): the pre-order menu and rf2_cart_swap substitutes.
      all(() => sb.from("fish_listings").select("id, seller_id, species, description, photo_url, pricing_options, is_available, is_preorder_enabled").or("is_available.eq.true,is_preorder_enabled.eq.true").is("deleted_at", null).order("id")),
    ]);
  } catch (e: any) {
    console.error("[cron/messaging] query failed", e?.message);
    return json({ error: `query failed: ${e?.message}` }, 500);
  }
  // Each seller's pre-order fish (rf2_catch_preorder) or available-today fish (rf2_catch_prices): "Surmai · Pomfret · Bombil" (names only, no prices).
  const menu = (id: string, flag: "is_preorder_enabled" | "is_available") => [...new Set((menuRows || []).filter((l: any) => l.seller_id === id && l[flag]).map((l: any) => fishName(l.description, l.species)))].slice(0, 3).join(" · ");
  const live = (id: string) => (menuRows || []).filter((l: any) => l.seller_id === id && optPrice(l) > 0).map((l: any) => ({
    name: fishName(l.description, l.species), species: l.species, price: optPrice(l), label: firstOpt(l)?.label ?? null, photo: l.photo_url ?? null,
    preorder: !!l.is_preorder_enabled,
  }));
  const sellers: MsgSeller[] = (sellerRows || []).filter((s: any) => s.is_active && !s.is_test).map((s: any) => ({ ...s, slug: sellerNameToSlug(s.name), menu: menu(s.id, "is_preorder_enabled"), todayMenu: menu(s.id, "is_available"), live: live(s.id) }));
  // Every seller's phone, switched off or not: a seller never gets buyer promos or reminders.
  const sellerPhones = new Set((sellerRows || []).map((s: any) => waNumber(s.phone)).filter(Boolean));
  const waTestOnly = list("WA_TEST_ONLY");
  // Founder's DND list: buyers.dnd_at (migration 088) plus numbers that haven't signed up yet.
  const dndPhones = new Set(list("MESSAGING_DND_PHONES", "9967743841"));
  // Never sellers; the founder only when he is on the WhatsApp test list.
  const skipPhone = (phone: string | null) => !phone || sellerPhones.has(phone) || (phone === FOUNDER && !waTestOnly.includes(phone));
  const orders = (orderRows || []).filter((o: any) => !o.is_test);
  // The order's photo: the costliest live item of its checkout (same cart_id, same seller), founder 30 Oct.
  const orderLine = (o: any) => o ? {
    id: o.id, seller_id: o.listing?.seller_id, name: fishName(o.listing?.description, o.listing?.species || o.species), species: o.listing?.species || o.species,
    photo: orderPhoto(o, orders), created_at: o.created_at, slot_start: o.delivery_slot_start ?? null, checkout: o.cart_id || o.id,
  } : null;
  // An unpaid checkout is named in full: "Surmai, Bombil and 1 more" (rf2_promo_unpaid).
  const unpaidLine = (o: any) => o ? { ...orderLine(o)!, name: checkoutFish(o, orders) } : null;
  const stateOf = (b: any): BuyerState => {
    const mine = orders.filter((o: any) => o.buyer_id === b.id).sort((x: any, y: any) => x.created_at.localeCompare(y.created_at));
    const done = mine.filter((o: any) => o.status === "completed");
    const pending = mine.filter((o: any) => o.status === "pending_payment" && !hasPaymentEvidence(o));
    const again = againOrder(done); // a fish still on the menu, named and pictured from the same row
    return {
      id: b.id, created_at: b.created_at, name: firstName(b.first_name), lat: b.lat, lng: b.lng,
      cart: (cartRows || []).filter((c: any) => c.buyer_id === b.id && c.listing).map((c: any) => ({
        seller_id: c.listing.seller_id, species: c.listing.species, photo: c.listing.photo_url, price: optPrice(c.listing),
        name: fishName(c.listing.description, c.listing.species), label: lineOpt(c.listing, c.pricing_option_id)?.label ?? null,
        // What the cart itself would still accept (option, mode, pause, stock), not just "listing is live".
        on_menu: !("reason" in checkLine({ pricing_option_id: c.pricing_option_id || "", qty: Number(c.qty) } as any, c.listing, c.placement_kind === "preorder" ? "preorder" : "same_day")),
        updated_at: c.updated_at,
      })),
      last_order_at: mine.at(-1)?.created_at ?? null,
      open_order: mine.some((o: any) => OPEN.includes(o.status)),
      last_paid_at: mine.filter((o: any) => OPEN.includes(o.status) || o.status === "completed").at(-1)?.created_at ?? null,
      unpaid: unpaidLine(pending.at(-1)),
      // One per checkout (its first order), oldest first: each unpaid checkout gets its own reminder.
      unpaids: pending.filter((o: any, i: number) => pending.findIndex((x: any) => (x.cart_id || x.id) === (o.cart_id || o.id)) === i).map(unpaidLine) as any,
      delivered: again && { ...orderLine(again)!, photo: again.listing?.photo_url || null },
      last_delivered_at: done.map((o: any) => o.updated_at).sort().pop() ?? null,
      opted_out: !!b.whatsapp_opt_out_at,
      dnd: !!b.dnd_at || dndPhones.has(waNumber(b.phone) || ""),
    };
  };
  /** The unpaid reminder for an order: rf2_unpaid (utility, photo) + its SMS. */
  const unpaidMessage = (o: any, b: any) => {
    const m = orderMessage("unpaid", o, b.first_name, now, undefined, orders);
    return { template: m.template, body: m.body, headerImage: m.image ?? null, link_path: `/track/${o.id}`, sms: orderSms("unpaid", o, b.first_name, undefined, orders) };
  };

  // ?test_phone: one sample of a message type, sent now to a test phone (skips every rule).
  const testPhone = waNumber(url.searchParams.get("test_phone"));
  if (testPhone) {
    if (!list("MESSAGING_TEST_PHONES", FOUNDER).includes(testPhone)) return json({ error: "test_phone must be on MESSAGING_TEST_PHONES" }, 400);
    const kind = url.searchParams.get("test_kind") || "cart";
    const viaSms = url.searchParams.get("channel") === "sms";
    const { data: tb } = await sb.from("buyers").select("id, phone, first_name, created_at, lat, lng, whatsapp_opt_in_at, whatsapp_opt_out_at, dnd_at").or(`phone.eq.${testPhone.slice(2)},phone.eq.+${testPhone}`).limit(1).maybeSingle();
    if (!tb) return json({ error: "no buyer with that phone" }, 404);
    const st = stateOf(tb);
    let msg: Omit<Dispatch, "dedupe_key" | "kind" | "slot_date" | "phone" | "whatsappOk"> | null = null;
    if (kind === "cart" || kind === "signup" || kind === "promo") {
      // No real cart → the costliest live item with a photo of the nearest seller, as a sample cart line.
      const seller = pickSeller(st, sellers);
      const offer = seller && offerAt(seller, Date.now());
      if (!seller || !offer) return json({ error: "no seller / no bookable slot right now" }, 404);
      const sample = [...(seller.live || [])].filter((m) => m.photo).sort((a, b) => b.price - a.price)[0];
      const withCart = st.cart.some((l) => l.on_menu) || !sample ? st : { ...st, cart: [{ seller_id: seller.id, name: sample.name, species: sample.species, photo: sample.photo, price: sample.price, on_menu: true, updated_at: new Date().toISOString() }] };
      const d = kind === "cart" ? cartMessage(Date.now(), withCart, seller, offer) : kind === "signup" ? signupMessage(Date.now(), st, seller, offer) : null;
      const p = kind === "promo" ? decide(Date.now(), st, sellers, [], true, true) : null; // test phone only: due now, and the per-buyer gaps (recent delivery, inactive) are skipped
      if (d) msg = { template: d.template, body: d.body, headerImage: d.photo, link_path: d.path, seller_id: seller.id, sms: d.sms };
      else if (p && !("skip" in p)) msg = { template: p.template, body: p.body, headerImage: p.photo, link_path: p.path, seller_id: seller.id, sms: promoSms(p, st, Date.now()) };
      else if (kind === "promo") return json({ error: `no promo fits right now: ${(p as any)?.skip}` }, 404);
    } else {
      // Order kinds: the test buyer's latest order (its real values).
      const o = orders.filter((x: any) => x.buyer_id === tb.id).at(-1) || (await sb.from("orders").select(`${ORDER_SELECT}, total_price, status, created_at, cart_id`).eq("buyer_id", tb.id).order("created_at", { ascending: false }).limit(1).maybeSingle()).data;
      if (!o) return json({ error: "the test buyer has no order to use" }, 404);
      const ev = (kind === "out" ? "out_for_delivery" : kind === "delivered" ? "completed" : kind) as OrderWaEvent;
      const { checkout } = await loadCheckout(sb, o.id);
      const cancel = ev === "cancelled" ? { reason: "the seller ran out of this fish", refund: `₹${Math.round(Number(o.total_price) || 0)}, started today, reaches your account in 5–7 working days` } : undefined;
      const m = orderMessage(ev, o, tb.first_name, Date.now(), cancel, checkout);
      msg = { template: m.template, body: m.body, headerImage: m.image ?? null, link_path: `/track/${o.id}`, order_id: o.id, sms: orderSms(ev, o, tb.first_name, cancel) };
    }
    if (!msg) return json({ error: `unknown test_kind ${kind}` }, 400);
    if (dry) return json({ test: true, dry: true, kind, template: msg.template, body: msg.body, sms: msg.sms ?? null, image: msg.headerImage ?? null });
    const r = await dispatch(sb, {
      ...msg, dedupe_key: `test:${kind}:${tb.id}:${Date.now()}`, kind: `test_${kind}`, slot_date: istDate(Date.now()), buyer_id: tb.id,
      phone: tb.phone, whatsappOk: !viaSms && !!tb.whatsapp_opt_in_at, smsOk: true, smsFallback: !viaSms && !!msg.sms,
    });
    return json({ test: true, kind, channel: viaSms ? "sms" : "whatsapp", template: msg.template, body: msg.body, sms: msg.sms ?? null, image: msg.headerImage ?? null, result: r });
  }

  // ?catchup_cart=<buyer id,…>: the cart reminder now for buyers the founder names (carts left while SMS was off,
  // founder 1 Nov). Skips the timing rules only: never sellers, DND, a buyer who ordered since, or an empty cart.
  const catchup = (url.searchParams.get("catchup_cart") || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (catchup.length) {
    const out: any[] = [];
    for (const id of catchup) {
      const b = (buyerRows || []).find((x: any) => x.id === id);
      const phone = b && waNumber(b.phone);
      if (!b || b.is_test || skipPhone(phone)) { out.push({ buyer: id, skip: "not a buyer we message" }); continue; }
      const st = stateOf(b);
      const who = `…${phone!.slice(-4)}`;
      if (st.dnd) { out.push({ buyer: who, skip: "dnd" }); continue; }
      const lastCart = st.cart.map((l) => l.updated_at).sort().pop();
      if (!lastCart || (st.last_order_at && st.last_order_at > lastCart)) { out.push({ buyer: who, skip: "no cart or ordered since" }); continue; }
      const seller = pickSeller(st, sellers);
      const offer = seller && offerAt(seller, now);
      const d = seller && offer ? cartMessage(now, st, seller, offer) : null;
      if (!d) { out.push({ buyer: who, skip: "no seller / slot / cart line on the menu" }); continue; }
      const whatsappOk = !!b.whatsapp_opt_in_at && !b.whatsapp_opt_out_at;
      const msg: Dispatch = { dedupe_key: `act_cart_catchup:${b.id}:${istDate(now)}`, kind: "act_cart", slot_date: istDate(now), buyer_id: b.id, seller_id: seller!.id,
        phone: b.phone, whatsappOk, template: d.template, body: d.body, headerImage: d.photo, link_path: d.path, sms: d.sms, smsOk: true, smsFallback: true };
      const line = { buyer: who, sms: d.sms ?? null, channel: whatsappOk ? "whatsapp" : "sms" };
      out.push(dry ? { ...line, sent: "dry_run" } : { ...line, ...(await dispatch(sb, msg)) });
    }
    return json({ dry, catchup_cart: out });
  }

  // 2. Per buyer: one activity reminder, else one promo.
  const report: any[] = [];
  // Signed up in the last 60 days, or older with a cart or an order since then (a returning buyer still gets reminders).
  const recent = (x: string) => Date.parse(x) >= now - 60 * 86_400_000;
  const active = new Set([...(cartRows || []).filter((c: any) => recent(c.updated_at)), ...(orderRows || [])].map((x: any) => x.buyer_id));
  for (const b of (buyerRows || []).filter((b: any) => recent(b.created_at) || active.has(b.id))) {
    const phone = waNumber(b.phone);
    if (b.is_test || skipPhone(phone)) continue;
    const state = stateOf(b);
    const history: SentLog[] = (logRows || []).filter((l: any) => l.buyer_id === b.id);
    const who = `…${phone!.slice(-4)}`;
    const whatsappOk = !!b.whatsapp_opt_in_at && !b.whatsapp_opt_out_at;
    const act = decideActivity(now, state, sellers, history);
    let msg: Dispatch | null = null;
    if (!("skip" in act)) {
      if (act.kind === "act_unpaid") {
        const o = orders.find((x: any) => x.id === act.order_id);
        if (o) msg = { ...unpaidMessage(o, b), dedupe_key: act.dedupe_key, kind: act.kind, slot_date: act.slot_date, order_id: o.id, buyer_id: b.id, seller_id: o.listing?.seller_id ?? null, phone: b.phone, whatsappOk, smsOk: true, smsFallback: true };
      } else {
        msg = { dedupe_key: act.dedupe_key, kind: act.kind, slot_date: act.slot_date, buyer_id: b.id, seller_id: act.seller.id, phone: b.phone, whatsappOk,
          template: act.template, body: act.body, headerImage: act.photo, link_path: act.path, sms: act.sms, smsOk: true, smsFallback: true };
      }
    } else {
      // Promos go by SMS when WhatsApp can't carry them (off, or not opted in): those wait for 10:00 (promotional SMS window).
      const bySms = !whatsappOk || env("WHATSAPP_OFF") === "true";
      const d = decide(now, state, sellers, history, promoNow, promoAll, bySms ? PROMO_SMS_START : 0);
      if ("skip" in d) { report.push({ buyer: who, skip: act.skip === "nothing due" ? d.skip : `${act.skip}; ${d.skip}` }); continue; }
      // One promo, one channel: WhatsApp if opted in, else the promotional SMS for their stage (founder, 1 Nov).
      // Never a WhatsApp→SMS fallback for promos; DND / STOP are already skipped by decide().
      msg = { dedupe_key: `${d.kind}:${b.id}:${d.slot_date}`, kind: d.kind, slot_date: d.slot_date, buyer_id: b.id, seller_id: d.seller.id, phone: b.phone, whatsappOk,
        template: d.template, body: d.body, headerImage: d.photo, link_path: d.path, sms: promoSms(d, state, now), smsOk: !state.dnd, smsFallback: false };
    }
    if (!msg) continue;
    // 2 reminder/promo SMS a week (founder, 1 Nov): an SMS-bound reminder or promo past the cap is skipped here (the DB refuses it anyway).
    const smsBound = !(whatsappOk && env("WHATSAPP_OFF") !== "true");
    if (smsBound && msg.sms && smsCapReached(history, now)) { report.push({ buyer: who, skip: "2 SMS this week" }); continue; }
    if (!whatsappOk && !msg.sms) { report.push({ buyer: who, skip: msg.kind === "promo" ? "promo: no WhatsApp and no promo SMS for this stage/time" : "not opted in to WhatsApp" }); continue; }
    const line = { buyer: who, kind: msg.kind, template: msg.template, vars: msg.body, sms: msg.sms ?? null, link: msg.link_path, image: msg.headerImage ?? null, channel: whatsappOk && env("WHATSAPP_OFF") !== "true" ? "whatsapp" : msg.sms ? "sms" : "none" };
    if (dry) { report.push({ ...line, sent: "dry_run" }); continue; }
    const r = await dispatch(sb, msg);
    report.push({ ...line, channel: r.channel ?? line.channel, sent: r.status, error: r.error });
  }

  return json({ dry, now: new Date(now).toISOString(), sync, messages: report.filter((r) => !r.skip), skipped: report.filter((r) => r.skip).length, skips: count(report.filter((r) => r.skip).map((r) => r.skip)) });
}

const count = (xs: string[]) => xs.reduce((m: Record<string, number>, x) => ((m[x] = (m[x] || 0) + 1), m), {});
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o, null, 2), { status, headers: { "Content-Type": "application/json" } });

export const POST = GET;
