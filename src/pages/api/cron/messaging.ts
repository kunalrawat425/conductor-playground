import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { SLOT_SELLER_COLUMNS } from "../../../lib/delivery-slots";
import { sellerNameToSlug } from "../../../lib/seller-display";
import { decide, istDate, offerAt, pickSeller, type BuyerState, type MsgSeller, type SentLog } from "../../../lib/messaging/schedule";
import { fishName, headerImage, priceLine, SIGNUP_IMAGE } from "../../../lib/messaging/templates";
import { dispatch } from "../../../lib/server/messaging";
import { waNumber } from "../../../lib/server/whatsapp";

export const prerender = false;

const PROMO_KINDS = ["A1", "A2", "B1", "B2", "weekend"];
const OPEN = ["paid", "confirmed", "out_for_delivery", "ready_for_pickup", "payment_required"];
const env = (k: string) => (import.meta.env as any)[k] || process.env[k] || "";

/**
 * POST /api/cron/messaging — the WhatsApp/push promo engine (runs every 30 min from GitHub
 * Actions, .github/workflows/messaging.yml). Auth: Bearer $CRON_SECRET.
 *   ?dry_run=1           report who would get what and why; nothing written or sent
 *   ?now=<ISO>           (dry run only) pretend it's this time, to test a whole week
 * Promos are sent only when MESSAGING_LIVE=true; otherwise every run is a report.
 * Also sends the seller "still waiting" reminder for paid orders not accepted after 30 min.
 */
export const POST: APIRoute = async ({ request, url }) => {
  if (!env("CRON_SECRET")) return json({ error: "CRON_SECRET not configured" }, 503);
  if (request.headers.get("authorization") !== `Bearer ${env("CRON_SECRET")}`) return json({ error: "Unauthorized" }, 401);
  const dry = url.searchParams.get("dry_run") === "1" || env("MESSAGING_LIVE") !== "true";
  const nowParam = url.searchParams.get("now");
  const now = dry && nowParam && !Number.isNaN(Date.parse(nowParam)) ? Date.parse(nowParam) : Date.now();
  const sb = createClient(env("PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_KEY"));

  const [{ data: sellerRows }, { data: buyerRows }, { data: cartRows }, { data: orderRows }, { data: logRows }] = await Promise.all([
    sb.from("sellers").select(`id, name, phone, lat, lng, delivery_rad, is_test, whatsapp_opt_in_at, whatsapp_opt_out_at, ${SLOT_SELLER_COLUMNS}`).eq("is_active", true),
    sb.from("buyers").select("id, phone, created_at, lat, lng, is_test, push_subscription, whatsapp_opt_in_at, whatsapp_opt_out_at").gte("created_at", new Date(now - 60 * 86_400_000).toISOString()),
    sb.from("buyer_cart").select("buyer_id, updated_at, listing:fish_listings(seller_id, species, description, photo_url, is_available, is_preorder_enabled, deleted_at)"),
    sb.from("orders").select("id, buyer_id, status, created_at, updated_at, is_test, species, listing:fish_listings(seller_id)").gte("created_at", new Date(now - 60 * 86_400_000).toISOString()),
    sb.from("message_log").select("buyer_id, seller_id, order_id, kind, slot_date, created_at").gte("created_at", new Date(now - 35 * 86_400_000).toISOString()),
  ]);
  const { data: menuRows } = await sb.from("fish_listings").select("seller_id, species, pricing_options").is("deleted_at", null).eq("is_available", true);
  // "Pomfret from ₹430, …" per seller, from today's live menu (rf_today_prices).
  const pricesFor = (sellerId: string) => priceLine((menuRows || []).filter((l: any) => l.seller_id === sellerId)
    .map((l: any) => ({ species: l.species, price: Number(l.pricing_options?.[0]?.price) || 0 })));

  const sellers: MsgSeller[] = (sellerRows || []).filter((s: any) => !s.is_test).map((s: any) => ({ ...s, slug: sellerNameToSlug(s.name) }));
  const sellerPhones = new Set((sellerRows || []).map((s: any) => waNumber(s.phone)).filter(Boolean));
  const testOnly = String(env("WA_TEST_ONLY")).split(",").map((s) => waNumber(s.trim())).filter(Boolean);
  const orders = (orderRows || []).filter((o: any) => !o.is_test);
  const report: any[] = [];

  // ?test_phone=<n>: send one message to that number right now (any time of day), only if it
  // is on MESSAGING_TEST_ONLY. For checking what a buyer receives on WhatsApp + push.
  const testPhone = waNumber(url.searchParams.get("test_phone"));
  if (testPhone) {
    const allow = String(env("MESSAGING_TEST_ONLY")).split(",").map((x) => waNumber(x.trim())).filter(Boolean);
    if (!allow.includes(testPhone)) return json({ error: "test_phone must be on MESSAGING_TEST_ONLY" }, 400);
    const { data: tb } = await sb.from("buyers").select("id, phone, created_at, lat, lng, push_subscription, whatsapp_opt_in_at").or(`phone.eq.${testPhone.slice(2)},phone.eq.+${testPhone}`).limit(1).maybeSingle();
    if (!tb) return json({ error: "no buyer with that phone" }, 404);
    const cart = (cartRows || []).filter((c: any) => c.buyer_id === tb.id && c.listing && !c.listing.deleted_at && (c.listing.is_available || c.listing.is_preorder_enabled));
    const st: BuyerState = { id: tb.id, created_at: tb.created_at, lat: tb.lat, lng: tb.lng, last_order_at: null, open_order: false, last_delivered_at: null, opted_out: false,
      cart: cart.map((c: any) => ({ seller_id: c.listing.seller_id, species: c.listing.species, photo: c.listing.photo_url, name: fishName(c.listing.description, c.listing.species), on_menu: true, updated_at: c.updated_at })) };
    const seller = pickSeller(st, sellers);
    const offer = seller ? offerAt(seller, Date.now()) ?? { mode: "preorder" as const, when: "your chosen day" } : null;
    if (!seller || !offer) return json({ error: "no seller for this buyer" }, 404);
    const items = [...new Set(st.cart.map((l) => l.name))].slice(0, 3);
    const personal = items.length > 0;
    const template = personal ? (offer.mode === "today" ? "rf_cart_today" : "rf_cart_preorder") : (offer.mode === "today" ? "rf_today_prices" : "rf_preorder_generic");
    const when = offer.mode === "preorder" ? offer.when : null;
    const body = template === "rf_cart_today" ? [items.join(" and ")] : template === "rf_cart_preorder" ? [items.join(" and "), when!] : template === "rf_preorder_generic" ? [when!] : [pricesFor(seller.id)];
    const first = st.cart.find((c: any) => c.seller_id === seller.id) as any;
    const image = personal ? headerImage(first?.photo, first?.species) : SIGNUP_IMAGE;
    const r = await dispatch(sb, {
      dedupe_key: `test:${tb.id}:${Date.now()}`, kind: "test", slot_date: istDate(Date.now()), buyer_id: tb.id, seller_id: seller.id,
      phone: tb.phone, whatsappOk: !!tb.whatsapp_opt_in_at, template, body, headerImage: image, link_path: personal ? `/s/${seller.slug}` : "/shop",
      push: { title: personal ? `Your ${items[0]} is waiting 🐟` : offer.mode === "today" ? "Craving fish today? 🐟" : "Plan your next fish meal 🐟",
              body: offer.mode === "today" ? "Order now and pick a 2-hour delivery slot." : `Pre-order now and get it on ${when}.`, image },
    });
    return json({ test: true, template, body, image, seller: seller.name, result: r });
  }

  for (const b of buyerRows || []) {
    const phone = waNumber(b.phone);
    // Never sellers or test accounts; the founder only when he is on the WhatsApp test list.
    if (b.is_test || (phone && sellerPhones.has(phone)) || (phone === "919870619974" && !testOnly.includes(phone))) continue;
    const mine = orders.filter((o: any) => o.buyer_id === b.id);
    const delivered = mine.filter((o: any) => o.status === "completed").map((o: any) => o.updated_at).sort().pop() ?? null;
    const state: BuyerState = {
      id: b.id, created_at: b.created_at, lat: b.lat, lng: b.lng,
      cart: (cartRows || []).filter((c: any) => c.buyer_id === b.id && c.listing).map((c: any) => ({
        seller_id: c.listing.seller_id, species: c.listing.species, photo: c.listing.photo_url,
        name: fishName(c.listing.description, c.listing.species),
        on_menu: !c.listing.deleted_at && (c.listing.is_available || c.listing.is_preorder_enabled),
        updated_at: c.updated_at,
      })),
      last_order_at: mine.map((o: any) => o.created_at).sort().pop() ?? null,
      open_order: mine.some((o: any) => OPEN.includes(o.status)),
      last_delivered_at: delivered,
      opted_out: !!b.whatsapp_opt_out_at,
    };
    const history: SentLog[] = (logRows || []).filter((l: any) => l.buyer_id === b.id && PROMO_KINDS.includes(l.kind));
    const d = decide(now, state, sellers, history);
    const who = phone ? `…${phone.slice(-4)}` : b.id.slice(0, 6);
    if ("skip" in d) { report.push({ buyer: who, skip: d.skip }); continue; }

    const whatsappOk = !!b.whatsapp_opt_in_at && !b.whatsapp_opt_out_at;
    const body = d.template === "rf_cart_today" ? [d.items.join(" and ")]
      : d.template === "rf_cart_preorder" ? [d.items.join(" and "), d.when!]
      : d.template === "rf_preorder_generic" ? [d.when!] : [pricesFor(d.seller.id)];
    if (d.template === "rf_today_prices" && !body[0]) { report.push({ buyer: who, skip: "no menu prices today" }); continue; }
    const first = d.personal ? (state.cart.find((c: any) => c.on_menu && c.seller_id === d.seller.id) as any) : null;
    const image = d.personal ? headerImage(first?.photo, first?.species) : SIGNUP_IMAGE;
    const line = { buyer: who, kind: d.kind, template: d.template, vars: body, link: d.path, image, channel: [whatsappOk && phone ? "whatsapp" : "", b.push_subscription ? "push" : ""].filter(Boolean).join("+") || "none" };
    if (dry) { report.push({ ...line, sent: "dry_run" }); continue; }
    const r = await dispatch(sb, {
      dedupe_key: `${d.kind}:${b.id}:${d.slot_date}`, kind: d.kind, slot_date: d.slot_date,
      buyer_id: b.id, seller_id: d.seller.id, phone: b.phone, whatsappOk,
      template: d.template, body, headerImage: image, link_path: d.path,
      push: { title: d.personal ? `Your ${d.items[0]} is waiting 🐟` : d.mode === "today" ? "Craving fish today? 🐟" : "Plan your next fish meal 🐟",
              body: d.mode === "today" ? "Order now and pick a 2-hour delivery slot." : `Pre-order now and get it on ${d.when}.`, image },
    });
    report.push({ ...line, sent: r.status, error: r.error });
  }

  // Seller: paid order not accepted 30 min after payment → one reminder.
  for (const o of orders.filter((x: any) => x.status === "paid" && now - Date.parse(x.updated_at) >= 30 * 60_000 && now - Date.parse(x.updated_at) < 6 * 3_600_000)) {
    const s: any = (sellerRows || []).find((x: any) => x.id === o.listing?.seller_id);
    if (!s) continue;
    const short = `#${String(o.id).slice(0, 8).toUpperCase()}`;
    const line = { seller: s.name, kind: "seller_waiting", order: short };
    if (dry) { report.push({ ...line, sent: "dry_run" }); continue; }
    const r = await dispatch(sb, {
      dedupe_key: `seller_waiting:${o.id}`, kind: "seller_waiting", slot_date: istDate(now), seller_id: s.id, order_id: o.id,
      phone: s.phone, whatsappOk: !!s.whatsapp_opt_in_at && !s.whatsapp_opt_out_at,
      template: "rf_seller_waiting", body: [short], link_path: `/dashboard/orders?order=${o.id}`,
    });
    report.push({ ...line, sent: r.status, error: r.error });
  }

  return json({ dry, now: new Date(now).toISOString(), messages: report.filter((r) => !r.skip), skipped: report.filter((r) => r.skip).length, skips: count(report.filter((r) => r.skip).map((r) => r.skip)) });
};

const count = (xs: string[]) => xs.reduce((m: Record<string, number>, x) => ((m[x] = (m[x] || 0) + 1), m), {});
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o, null, 2), { status, headers: { "Content-Type": "application/json" } });
