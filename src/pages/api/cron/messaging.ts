import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { SLOT_SELLER_COLUMNS } from "../../../lib/delivery-slots";
import { sellerNameToSlug } from "../../../lib/seller-display";
import { compose, decide, inSendHours, istDate, offerAt, pickSeller, PROMO_KINDS, type BuyerState, type Decision, type MsgSeller, type SentLog } from "../../../lib/messaging/schedule";
import { firstName, fishName } from "../../../lib/messaging/templates";
import { dispatch } from "../../../lib/server/messaging";
import { ORDER_SELECT, orderMessage, orderPhoto } from "../../../lib/server/notify-order-whatsapp";
import { hasPaymentEvidence } from "../../../lib/server/reminders";
import { waNumber } from "../../../lib/server/whatsapp";

export const prerender = false;

const OPEN = ["paid", "confirmed", "out_for_delivery", "ready_for_pickup", "payment_required"];
const env = (k: string) => (import.meta.env as any)[k] || process.env[k] || "";
/** A listing's first pricing option: its price (pre-order: top of the range when no price) and label. */
const firstOpt = (l: any) => (Array.isArray(l?.pricing_options) ? l.pricing_options[0] : null);
const optPrice = (l: any) => Number(firstOpt(l)?.price) || Number(firstOpt(l)?.preorder_price_max) || 0;

/**
 * POST /api/cron/messaging — the WhatsApp/push promo engine (runs every 30 min from GitHub
 * Actions, .github/workflows/messaging.yml). Auth: Bearer $CRON_SECRET.
 *   ?dry_run=1           report who would get what and why; nothing written or sent
 *   ?now=<ISO>           (dry run only) pretend it's this time, to test a whole week
 * Promos are sent only when MESSAGING_LIVE=true; otherwise every run is a report.
 * Also sends the buyer one rf2_unpaid nudge for an order still unpaid 10 min after checkout.
 * Sellers get no WhatsApp (founder: email only).
 */
export const POST: APIRoute = async ({ request, url }) => {
  if (!env("CRON_SECRET")) return json({ error: "CRON_SECRET not configured" }, 503);
  if (request.headers.get("authorization") !== `Bearer ${env("CRON_SECRET")}`) return json({ error: "Unauthorized" }, 401);
  const dry = url.searchParams.get("dry_run") === "1" || env("MESSAGING_LIVE") !== "true";
  const nowParam = url.searchParams.get("now");
  const now = dry && nowParam && !Number.isNaN(Date.parse(nowParam)) ? Date.parse(nowParam) : Date.now();
  const sb = createClient(env("PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_KEY"));

  const [{ data: sellerRows }, { data: buyerRows }, { data: cartRows }, { data: orderRows }, { data: logRows }, { data: menuRows }] = await Promise.all([
    sb.from("sellers").select(`id, name, phone, lat, lng, delivery_rad, is_test, ${SLOT_SELLER_COLUMNS}`).eq("is_active", true),
    sb.from("buyers").select("id, phone, first_name, created_at, lat, lng, is_test, push_subscription, whatsapp_opt_in_at, whatsapp_opt_out_at").gte("created_at", new Date(now - 60 * 86_400_000).toISOString()),
    sb.from("buyer_cart").select("buyer_id, updated_at, listing:fish_listings(seller_id, species, description, photo_url, pricing_options, is_available, is_preorder_enabled, deleted_at)"),
    sb.from("orders").select(`${ORDER_SELECT}, total_price, status, created_at, updated_at, cart_id, razorpay_payment_id, payment_verified_at, payment_screenshot_urls`).gte("created_at", new Date(now - 60 * 86_400_000).toISOString()),
    // Only real sends count toward the 3-day gap: a failed or dry-run row (no channel reached them) must not block the next slot.
    sb.from("message_log").select("buyer_id, seller_id, order_id, kind, slot_date, created_at").in("status", ["sent", "delivered", "read"]).gte("created_at", new Date(now - 35 * 86_400_000).toISOString()),
    // Live listings only (available or pre-order): the pre-order menu and rf2_cart_swap substitutes.
    sb.from("fish_listings").select("seller_id, species, description, photo_url, pricing_options, is_available, is_preorder_enabled").or("is_available.eq.true,is_preorder_enabled.eq.true").is("deleted_at", null),
  ]);
  // Each seller's pre-order fish for rf2_catch_preorder: "Surmai · Pomfret · Bombil" (names only, no prices).
  const menu = (id: string) => [...new Set((menuRows || []).filter((l: any) => l.seller_id === id && l.is_preorder_enabled).map((l: any) => fishName(l.description, l.species)))].slice(0, 3).join(" · ");
  const live = (id: string) => (menuRows || []).filter((l: any) => l.seller_id === id && optPrice(l) > 0).map((l: any) => ({
    name: fishName(l.description, l.species), species: l.species, price: optPrice(l), label: firstOpt(l)?.label ?? null, photo: l.photo_url ?? null,
    preorder: !!l.is_preorder_enabled,
  }));
  const sellers: MsgSeller[] = (sellerRows || []).filter((s: any) => !s.is_test).map((s: any) => ({ ...s, slug: sellerNameToSlug(s.name), menu: menu(s.id), live: live(s.id) }));
  const sellerPhones = new Set((sellerRows || []).map((s: any) => waNumber(s.phone)).filter(Boolean));
  const testOnly = String(env("WA_TEST_ONLY")).split(",").map((s) => waNumber(s.trim())).filter(Boolean);
  // Never sellers; the founder only when he is on the WhatsApp test list.
  const skipPhone = (phone: string | null) => (!!phone && sellerPhones.has(phone)) || (phone === "919870619974" && !testOnly.includes(phone));
  const orders = (orderRows || []).filter((o: any) => !o.is_test);
  // The order's photo: the costliest live item of its checkout (same cart_id, same seller), founder 30 Oct.
  const orderLine = (o: any) => o ? { id: o.id, seller_id: o.listing?.seller_id, name: fishName(o.listing?.description, o.listing?.species || o.species), species: o.listing?.species || o.species,
    photo: orderPhoto(o, orders) } : null;
  const pushFor = (d: Decision, image: string | null) => ({
    title: d.template === "rf2_order_again" ? `Ready for more ${d.items[0]}? 🐟` : d.template === "rf2_cart_swap" ? `Your ${d.items[0]} isn't on today's menu 🐟` : d.personal ? `Your ${d.items[0]} is waiting 🐟` : "Plan your next fish meal 🐟",
    body: d.mode === "today" ? "Order now and pick a 2-hour delivery slot." : `Pre-order now and get it on ${d.when}.`, image: image ?? undefined,
  });
  const report: any[] = [];

  // ?test_phone=<n>: send one message to that number right now (any time of day), only if it
  // is on MESSAGING_TEST_ONLY. For checking what a buyer receives on WhatsApp + push.
  const testPhone = waNumber(url.searchParams.get("test_phone"));
  if (testPhone) {
    const allow = String(env("MESSAGING_TEST_ONLY")).split(",").map((x) => waNumber(x.trim())).filter(Boolean);
    if (!allow.includes(testPhone)) return json({ error: "test_phone must be on MESSAGING_TEST_ONLY" }, 400);
    const { data: tb } = await sb.from("buyers").select("id, phone, first_name, created_at, lat, lng, push_subscription, whatsapp_opt_in_at").or(`phone.eq.${testPhone.slice(2)},phone.eq.+${testPhone}`).limit(1).maybeSingle();
    if (!tb) return json({ error: "no buyer with that phone" }, 404);
    const cart = (cartRows || []).filter((c: any) => c.buyer_id === tb.id && c.listing && !c.listing.deleted_at && (c.listing.is_available || c.listing.is_preorder_enabled));
    const st: BuyerState = { id: tb.id, created_at: tb.created_at, name: firstName(tb.first_name), lat: tb.lat, lng: tb.lng, last_order_at: null, open_order: false,
      unpaid: null, delivered: null, last_delivered_at: null, opted_out: false,
      cart: cart.map((c: any) => ({ seller_id: c.listing.seller_id, species: c.listing.species, photo: c.listing.photo_url, price: optPrice(c.listing), name: fishName(c.listing.description, c.listing.species), on_menu: true, updated_at: c.updated_at })) };
    const seller = pickSeller(st, sellers);
    const offer = seller ? offerAt(seller, Date.now()) : null;
    const d = seller && offer ? compose("B1", st.cart.length ? "cart" : "generic", Date.now(), st, seller, offer) : null;
    if (!d) return json({ error: "nothing to send this buyer right now (no seller, no bookable slot, or no pre-order for tomorrow)" }, 404);
    const image = d.photo; // a seller's own listing photo or null, never stock (founder 30 Oct)
    const r = await dispatch(sb, {
      dedupe_key: `test:${tb.id}:${Date.now()}`, kind: "test", slot_date: istDate(Date.now()), buyer_id: tb.id, seller_id: d.seller.id,
      phone: tb.phone, whatsappOk: !!tb.whatsapp_opt_in_at, template: d.template, body: d.body, headerImage: image, link_path: d.path,
      push: pushFor(d, image),
    });
    return json({ test: true, template: d.template, body: d.body, image, seller: d.seller.name, result: r });
  }

  for (const b of buyerRows || []) {
    const phone = waNumber(b.phone);
    if (b.is_test || skipPhone(phone)) continue;
    const mine = orders.filter((o: any) => o.buyer_id === b.id).sort((x: any, y: any) => x.created_at.localeCompare(y.created_at));
    const done = mine.filter((o: any) => o.status === "completed");
    const state: BuyerState = {
      id: b.id, created_at: b.created_at, name: firstName(b.first_name), lat: b.lat, lng: b.lng,
      cart: (cartRows || []).filter((c: any) => c.buyer_id === b.id && c.listing).map((c: any) => ({
        seller_id: c.listing.seller_id, species: c.listing.species, photo: c.listing.photo_url, price: optPrice(c.listing),
        name: fishName(c.listing.description, c.listing.species),
        on_menu: !c.listing.deleted_at && (c.listing.is_available || c.listing.is_preorder_enabled),
        updated_at: c.updated_at,
      })),
      last_order_at: mine.at(-1)?.created_at ?? null,
      open_order: mine.some((o: any) => OPEN.includes(o.status)),
      unpaid: orderLine(mine.filter((o: any) => o.status === "pending_payment" && !hasPaymentEvidence(o)).at(-1)),
      delivered: orderLine(done.at(-1)),
      last_delivered_at: done.map((o: any) => o.updated_at).sort().pop() ?? null,
      opted_out: !!b.whatsapp_opt_out_at,
    };
    const history: SentLog[] = (logRows || []).filter((l: any) => l.buyer_id === b.id && PROMO_KINDS.includes(l.kind));
    const d = decide(now, state, sellers, history);
    const who = phone ? `…${phone.slice(-4)}` : b.id.slice(0, 6);
    if ("skip" in d) { report.push({ buyer: who, skip: d.skip }); continue; }

    const whatsappOk = !!b.whatsapp_opt_in_at && !b.whatsapp_opt_out_at;
    // Every promo: a seller's own listing photo (costliest item), or none; never stock (founder 30 Oct).
    const image = d.photo;
    const line = { buyer: who, kind: d.kind, template: d.template, vars: d.body, link: d.path, image, channel: [whatsappOk && phone ? "whatsapp" : "", b.push_subscription ? "push" : ""].filter(Boolean).join("+") || "none" };
    if (dry) { report.push({ ...line, sent: "dry_run" }); continue; }
    const r = await dispatch(sb, {
      dedupe_key: `${d.kind}:${b.id}:${d.slot_date}`, kind: d.kind, slot_date: d.slot_date,
      buyer_id: b.id, seller_id: d.seller.id, phone: b.phone, whatsappOk,
      template: d.template, body: d.body, headerImage: image, link_path: d.path, push: pushFor(d, image),
    });
    report.push({ ...line, sent: r.status, error: r.error });
  }

  // Buyer: order still unpaid 10 min after checkout → one rf2_unpaid (utility) per checkout, while its slot is ahead.
  const unpaid = orders.filter((o: any) => o.status === "pending_payment" && o.buyer_id && !hasPaymentEvidence(o)
    && now - Date.parse(o.created_at) >= 10 * 60_000 && now - Date.parse(o.created_at) < 12 * 3_600_000
    && (!o.delivery_slot_start || Date.parse(o.delivery_slot_start) > now));
  if (unpaid.length && inSendHours(now)) {
    const { data: ub } = await sb.from("buyers").select("id, phone, first_name, is_test, whatsapp_opt_in_at").in("id", [...new Set(unpaid.map((o: any) => o.buyer_id))]);
    const seen = new Set<string>();
    for (const o of unpaid) {
      const b: any = (ub || []).find((x: any) => x.id === o.buyer_id);
      const key = `unpaid:${o.cart_id || o.id}`;
      if (!b || b.is_test || skipPhone(waNumber(b.phone)) || seen.has(key)) continue;
      seen.add(key);
      const m = orderMessage("unpaid", o, b.first_name, now, undefined, orders);
      const line = { buyer: `…${String(b.phone || "").slice(-4)}`, kind: "order_unpaid", template: m.template, vars: m.body, link: `/track/${o.id}` };
      if (dry) { report.push({ ...line, sent: "dry_run" }); continue; }
      const r = await dispatch(sb, {
        dedupe_key: key, kind: "order_unpaid", slot_date: istDate(now), order_id: o.id, buyer_id: b.id,
        phone: b.phone, whatsappOk: !!b.whatsapp_opt_in_at, template: m.template, body: m.body, headerImage: m.image, link_path: `/track/${o.id}`,
      });
      report.push({ ...line, sent: r.status, error: r.error });
    }
  }

  return json({ dry, now: new Date(now).toISOString(), messages: report.filter((r) => !r.skip), skipped: report.filter((r) => r.skip).length, skips: count(report.filter((r) => r.skip).map((r) => r.skip)) });
};

const count = (xs: string[]) => xs.reduce((m: Record<string, number>, x) => ((m[x] = (m[x] || 0) + 1), m), {});
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o, null, 2), { status, headers: { "Content-Type": "application/json" } });

/** Vercel Cron calls GET (same Bearer $CRON_SECRET): Tue/Fri 6 PM and Sat/Sun 8:30 AM IST slots, vercel.json. */
export const GET = POST;
