import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLiveFor, templatePayload, validWebhookSignature, waNumber, watiParams, watiTemplate } from "../../src/lib/server/whatsapp";
import { TEMPLATES, DRAFT_TEMPLATES, TEMPLATE, templateProblems, fishName, firstName, PROMO_IMAGE, SIGNUP_IMAGE, varCount } from "../../src/lib/messaging/templates";
import { againOrder, orderMessage, orderPhoto, type OrderWaEvent } from "../../src/lib/server/notify-order-whatsapp";
import { DEFAULT_PROMO_IMAGE } from "../../src/lib/server/buyer-order-push-copy";

/**
 * The 19 templates APPROVED on WABA 1491951102724224 (Graph API message_templates, 29 Oct 2026):
 * name → [category, image header?, body variable count].
 */
const APPROVED: Record<string, [string, boolean, number]> = {
  rf2_welcome: ["MARKETING", true, 3], rf2_welcome_search: ["MARKETING", true, 3],
  rf2_cart_today: ["MARKETING", true, 4], rf2_cart_preorder: ["MARKETING", true, 4],
  rf2_promo_cart: ["MARKETING", true, 5], rf2_promo_unpaid: ["MARKETING", true, 4],
  rf2_order_again: ["MARKETING", true, 4], rf2_weekend: ["MARKETING", true, 4],
  rf2_catch_preorder: ["MARKETING", true, 5], rf2_catch_prices: ["MARKETING", true, 5],
  rf2_login_otp: ["AUTHENTICATION", false, 1],
  rf2_unpaid: ["UTILITY", true, 4], rf2_paid: ["UTILITY", false, 3], rf2_paid_evening: ["UTILITY", false, 4],
  rf2_paid_fast: ["UTILITY", false, 4], rf2_confirmed: ["UTILITY", true, 3], rf2_out: ["UTILITY", false, 2],
  rf2_delivered: ["UTILITY", true, 3], rf2_cancelled: ["UTILITY", false, 4],
  rf2_cart_swap: ["MARKETING", true, 5], // submitted 30 Oct, approved and delivering 31 Oct
};
/** rf_* strings in src that are not WhatsApp templates. */
const NOT_TEMPLATES = new Set(["rf_internal", "rf_utm", "rf_resume_checkout"]);
const srcFiles = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? srcFiles(p) : [p];
});

import { dispatch, smsFallbackFor } from "../../src/lib/server/messaging";
import { cut30, SMS_TEXT, smsPayload, smsReady, smsVarCount } from "../../src/lib/server/sms";
import { orderSms } from "../../src/lib/server/notify-order-whatsapp";
import { matchWatiItem, nextStatus } from "../../src/lib/server/wati-status";

/** Tiny in-memory message_log with the unique dedupe_key the migration creates. */
function fakeSb() {
  const rows: any[] = [];
  let n = 0;
  return {
    rows,
    from: () => ({
      select: () => ({ in: async (_k: string, keys: string[]) => ({ data: rows.filter((r) => keys.includes(r.dedupe_key)), error: null }) }),
      upsert: (row: any) => ({
        select: async () => {
          if (rows.some((r) => r.dedupe_key === row.dedupe_key)) return { data: [], error: null };
          const r = { ...row, id: `00000000-0000-4000-8000-00000000000${++n}`, short_id: `s${n}abcdefgh` }; rows.push(r); return { data: [{ id: r.id, short_id: r.short_id }], error: null };
        },
      }),
      update: (patch: any) => ({ eq: async (_k: string, id: string) => { Object.assign(rows.find((r) => r.id === id) || {}, patch); return {}; } }),
    }),
  };
}

beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("numbers, payloads, signatures", () => {
  it("normalises Indian mobiles only", () => {
    expect(waNumber("9870619974")).toBe("919870619974");
    expect(waNumber("+91 98706 19974")).toBe("919870619974");
    expect(waNumber("1234")).toBeNull();
    expect(waNumber("0221234567")).toBeNull();
  });
  it("builds Meta's template body: image header, text vars, URL suffix, STOP quick reply", () => {
    const p = templatePayload({ to: "919870619974", name: "rf2_cart_today", headerImage: "https://x/fish.jpg", body: ["Baby Rawas"], urlSuffix: "abc", quickReplyPayload: "STOP" });
    expect(p.template.components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://x/fish.jpg" } }] },
      { type: "body", parameters: [{ type: "text", text: "Baby Rawas" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "abc" }] },
      { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "STOP" }] },
    ]);
    expect(p).toMatchObject({ messaging_product: "whatsapp", to: "919870619974", type: "template", template: { name: "rf2_cart_today", language: { code: "en" } } });
  });
  it("accepts only Meta's HMAC-SHA256 signature made with the app secret", () => {
    const body = '{"entry":[]}';
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(validWebhookSignature(body, sig, "s3cret")).toBe(true);
    expect(validWebhookSignature(body + " ", sig, "s3cret")).toBe(false);
    expect(validWebhookSignature(body, sig, "other")).toBe(false);
    expect(validWebhookSignature(body, null, "s3cret")).toBe(false);
  });
});

describe("templates", () => {
  it("mirror the 19 approved rf2 templates + rf2_cart_swap (category, header, variable count) and pass Meta + brand checks", () => {
    expect(Object.fromEntries(TEMPLATES.map((t) => [t.name, [t.category, t.header === "IMAGE", t.body.match(/\{\{\d+\}\}/g)?.length ?? 0]]))).toEqual(APPROVED);
    for (const t of TEMPLATES) expect(templateProblems(t), t.name).toEqual([]);
  });
  it("rf3 gentle-tone drafts pass Meta + brand checks, stay out of the sendable set, and keep the tone rules", () => {
    for (const t of DRAFT_TEMPLATES) {
      expect(t.name, t.name).toMatch(/^rf3_/);
      expect(TEMPLATE[t.name], t.name).toBeUndefined();
      expect(templateProblems(t), t.name).toEqual([]);
      const text = `${t.body} ${t.buttons.map((b) => b.text).join(" ")}`;
      expect(text, t.name).not.toMatch(/\blocal\b|\btrack|not paid|pay now|\{\{\d+\}\}'s menu/i);
      expect(t.body.match(/\p{Extended_Pictographic}/gu)?.length ?? 0, t.name).toBeLessThanOrEqual(1);
    }
  });
  it("every template name in src is an approved rf2 template; no v1 rf_* names are left", () => {
    const names = new Set<string>();
    for (const f of srcFiles("src")) {
      for (const m of readFileSync(f, "utf8").matchAll(/["'`](rf2?_[a-z_]+)/g)) if (!NOT_TEMPLATES.has(m[1])) names.add(m[1]);
    }
    expect([...names].filter((n) => !APPROVED[n])).toEqual([]);
    expect(names.has("rf2_cart_today") && names.has("rf2_cancelled")).toBe(true); // the scan does see the senders
  });
  it("order updates fill exactly the variables Meta defines", () => {
    const ord = { id: "eeb0f7ac-1111-4000-8000-000000000000", species: "pomfret", is_preorder: true,
      delivery_slot_start: "2026-10-25T03:30:00Z", delivery_slot_end: "2026-10-25T05:30:00Z",
      listing: { species: "pomfret", description: "Silver Pomfret · Cut pcs", photo_url: "https://x/p.jpg", seller: { name: "Fishtokri" } } };
    const noon = Date.parse("2026-10-24T12:00:00+05:30"), night = Date.parse("2026-10-24T20:00:00+05:30");
    const events: OrderWaEvent[] = ["unpaid", "paid", "confirmed", "out_for_delivery", "completed", "cancelled"];
    for (const e of events) {
      const m = orderMessage(e, ord, "manoj kumar", noon);
      expect(m.body, m.template).toHaveLength(varCount(m.template));
      expect(!!m.image, m.template).toBe(APPROVED[m.template][1]);
    }
    expect(orderMessage("paid", ord, "manoj", noon)).toEqual({ template: "rf2_paid", body: ["#EEB0F7AC", "Manoj", "Fishtokri"] });
    expect(orderMessage("paid", ord, null, night)).toEqual({ template: "rf2_paid_evening", body: ["#EEB0F7AC", "fish lover", "Sun 25 Oct, 9–11 AM", "Fishtokri"] });
    expect(orderMessage("paid", { ...ord, is_preorder: false }, "manoj", night).template).toBe("rf2_paid");
    expect(orderMessage("confirmed", ord, "manoj", noon).body).toEqual(["Fishtokri", "#EEB0F7AC", "Sun 25 Oct, 9–11 AM"]);
    expect(orderMessage("out_for_delivery", ord, "manoj", noon).body).toEqual(["#EEB0F7AC", "11 AM"]);
    // Slot already over (late confirm / late dispatch): "soon", never a time that has passed.
    const late = Date.parse("2026-10-25T12:00:00+05:30");
    expect(orderMessage("out_for_delivery", ord, "manoj", late).body[1]).toBe("soon");
    expect(orderMessage("confirmed", ord, "manoj", late).body[2]).toBe("soon");
    expect(orderSms("out_for_delivery", ord, "manoj", undefined, undefined, late).vars[1]).toBe("soon");
    expect(orderMessage("completed", ord, "manoj", noon).body).toEqual(["Silver Pomfret", "Manoj", "Fishtokri"]);
    expect(orderMessage("cancelled", ord, "manoj", noon, { reason: "the seller ran out of pomfret today", refund: "₹1,380, started today, reaches your account in 5–7 working days" }).body)
      .toEqual(["Manoj", "#EEB0F7AC", "the seller ran out of pomfret today", "₹1,380, started today, reaches your account in 5–7 working days"]);
    // One item removed, the rest goes ahead: the cart's order number and the reason name the item.
    const removed = orderMessage("cancelled", ord, "manoj", noon, { reason: "Not available.", refund: "₹285 refund is being processed, it reaches you in 5–7 working days", removedFrom: "aa11bb22-0000-4000-8000-000000000000" });
    expect(removed.template).toBe("rf2_cancelled");
    expect(removed.body).toEqual(["Manoj", "#AA11BB22 (Silver Pomfret)", "the seller removed Silver Pomfret (Not available), the rest of your order goes ahead", "₹285 refund is being processed, it reaches you in 5–7 working days"]);
    expect(firstName("  ")).toBe("fish lover");
  });
  it("catch a price, a trailing variable and a promo in a utility template", () => {
    const base = TEMPLATES[0];
    expect(templateProblems({ ...base, body: "Pomfret at ₹400 today.", examples: [] })[0]).toMatch(/brand/);
    expect(templateProblems({ ...base, body: "Get it on {{1}}", examples: ["x"] })).toContain("variable at start or end of body");
    expect(templateProblems({ ...base, body: "Get it on {{1}}.", examples: ["x"] })).toContain("variable at start or end of body");
    expect(templateProblems({ ...TEMPLATES.find((t) => t.category === "UTILITY")!, body: "Big sale on order {{1}} now.", examples: ["x"] })).toContain("promo wording in a utility template");
  });
  it("fish name: description when it names the fish, else the species", () => {
    expect(fishName("Baby Rawas · Cut pcs + head & tail", "rawas")).toBe("Baby Rawas");
    expect(fishName("Seawater tiger prawns · Tail on", "prawns")).toBe("Seawater tiger prawns");
    expect(fishName("Halwa (Black Pomfret) · Cut pcs", "halwa")).toBe("Halwa (Black Pomfret)");
    expect(fishName("Sassoon Dock, bought same morning · Never frozen", "surmai")).toBe("Surmai");
    expect(fishName("Fresh bangda, Sassoon Dock same morning · Never frozen", "bangda")).toBe("Bangda");
    expect(fishName("Pomfret, Sassoon Dock same morning", "pomfret")).toBe("Pomfret");
    expect(fishName(null, "bombil")).toBe("Bombil");
    expect(fishName(null, null)).toBe("fish");
  });
});

describe("order update photo: the checkout's costliest live item, never stock (founder, 30 Oct)", () => {
  const STOCK = [PROMO_IMAGE, SIGNUP_IMAGE, DEFAULT_PROMO_IMAGE];
  const isStock = (u: unknown) => typeof u === "string" && (STOCK.some((s) => u.endsWith(s)) || /\/fish\/[a-z]+\.jpg$/.test(u));
  const o = (id: string, price: number, photo: string | null, x: any = {}) => ({
    id: `${id}0000000-1111-4000-8000-000000000000`, cart_id: "cart1", status: "confirmed", total_price: price, species: "pomfret",
    delivery_slot_start: "2026-10-25T03:30:00Z", delivery_slot_end: "2026-10-25T05:30:00Z",
    listing: { species: "pomfret", description: "Silver Pomfret", photo_url: photo, seller_id: "ft", seller: { name: "Fishtokri" } }, ...x,
  });
  const cheap = o("a", 300, "https://x/bombil.jpg");
  const dear = o("b", 1380, "https://x/pomfret.jpg");
  const other = o("c", 5000, "https://x/other-seller.jpg", { listing: { ...dear.listing, seller_id: "nm" } });
  const otherCart = o("d", 4000, "https://x/other-cart.jpg", { cart_id: "cart2" });
  const removed = o("e", 3000, "https://x/removed.jpg", { status: "cancelled" });
  const noon = Date.parse("2026-10-24T12:00:00+05:30");

  it("confirmed / delivered / unpaid use the costliest live item of the same checkout and seller", () => {
    const checkout = [cheap, dear, other, otherCart, removed];
    for (const e of ["unpaid", "confirmed", "completed"] as OrderWaEvent[]) {
      expect(orderMessage(e, cheap, "manoj", noon, undefined, checkout).image, e).toBe("https://x/pomfret.jpg");
    }
  });
  it("unpaid reminders name the whole checkout, costliest first; the SMS value fits 30 chars", () => {
    const fish = (id: string, price: number, description: string, species: string) => o(id, price, null, { status: "pending_payment", listing: { ...cheap.listing, description, species } });
    const checkout = [fish("a", 300, "Bombil", "bombil"), fish("b", 1380, "Silver Pomfret", "pomfret"), fish("c", 900, "Surmai", "surmai"), otherCart, removed];
    expect(orderMessage("unpaid", checkout[0], "manoj", noon, undefined, checkout).body[2]).toBe("Silver Pomfret, Surmai and 1 more");
    expect(orderSms("unpaid", checkout[0], "manoj", undefined, checkout).vars[1]).toBe("Silver Pomfret and 2 more");
    expect(orderMessage("unpaid", checkout[0], "manoj", noon, undefined, checkout.slice(0, 1)).body[2]).toBe("Bombil");
  });
  it("the costliest item has no photo → null, no cheaper or stock fallback", () => {
    const checkout = [cheap, { ...dear, listing: { ...dear.listing, photo_url: null } }];
    expect(orderMessage("confirmed", cheap, "manoj", noon, undefined, checkout).image).toBeNull();
    expect(orderMessage("confirmed", { ...cheap, listing: { ...cheap.listing, photo_url: null } }, "manoj", noon).image).toBeNull();
  });
  it("an item the seller removed shows its own photo, or none", () => {
    const cancel = { reason: "Not available", removedFrom: dear.id };
    expect(orderPhoto(removed, [cheap, dear, removed], cancel)).toBe("https://x/removed.jpg");
    expect(orderPhoto({ ...removed, listing: { ...removed.listing, photo_url: null } }, [cheap, dear], cancel)).toBeNull();
    expect(orderMessage("cancelled", removed, "manoj", noon, cancel, [cheap, dear, removed]).image ?? null).toBeNull(); // rf2_cancelled has no image header
  });
  it("order again names the costliest item of the last checkout that is still on the menu; none live → null", () => {
    const live = { is_available: true, deleted_at: null };
    const bangda = o("g", 900, "https://x/bangda.jpg", { status: "completed", cart_id: "c9", listing: { ...cheap.listing, ...live, is_available: false, description: "Bangda" } });
    const bombil = o("h", 240, "https://x/bombil.jpg", { status: "completed", cart_id: "c9", listing: { ...cheap.listing, ...live, description: "Bombil" } });
    const older = o("i", 2000, "https://x/old.jpg", { status: "completed", cart_id: "c1", listing: { ...cheap.listing, ...live } });
    expect(againOrder([older, bangda, bombil])?.listing.photo_url).toBe("https://x/bombil.jpg");
    expect(againOrder([older, bangda])).toBeNull();
    expect(againOrder([])).toBeNull();
  });
  it("no stock URL in any order update", () => {
    const bare = o("f", 500, null, { cart_id: null, listing: { species: "rawas", description: null, photo_url: null, seller_id: "ft", seller: { name: "Fishtokri" } } });
    for (const e of ["unpaid", "paid", "confirmed", "out_for_delivery", "completed", "cancelled"] as OrderWaEvent[]) {
      for (const ord of [bare, cheap]) expect(isStock(orderMessage(e, ord, "manoj", noon).image), e).toBe(false);
    }
  });
});

describe("dispatch: one channel, once (founder 30 Oct)", () => {
  const msg = { dedupe_key: "act_cart:b1:2026-10-24", kind: "act_cart", slot_date: "2026-10-24", buyer_id: "b1", phone: "9870619974", whatsappOk: true,
    template: "rf2_cart_today", body: ["Priya", "Baby Rawas", "Fishtokri", "today, 4–6 PM"], headerImage: "https://x/r.jpg", link_path: "/s/fishtokri",
    sms: { key: "CART" as const, vars: ["Priya", "Baby Rawas", "Fishtokri", "today, 4–6 PM"] }, smsFallback: true };
  const wa = () => { vi.stubEnv("WA_PHONE_NUMBER_ID", "123"); vi.stubEnv("WA_TOKEN", "tok"); };
  const sms = () => { vi.stubEnv("SMS_LIVE", "true"); vi.stubEnv("MSG91_AUTH_KEY", "k"); vi.stubEnv("MSG91_FLOW_CART", "flowcart"); };
  const ok = (body: any) => new Response(JSON.stringify(body), { status: 200 });
  it("opted in → WhatsApp only, logged with payload, button = /go/<id>", async () => {
    wa(); sms();
    (globalThis.fetch as any).mockResolvedValue(ok({ messages: [{ id: "wamid.X" }] }));
    const sb = fakeSb();
    const r = await dispatch(sb, msg);
    expect([r.status, r.channel]).toEqual(["sent", "whatsapp"]);
    expect(sb.rows.map((x) => [x.channel, x.status, x.dedupe_key])).toEqual([["whatsapp", "sent", "act_cart:b1:2026-10-24:whatsapp"]]);
    expect(sb.rows[0].payload.sms.key).toBe("CART");
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(sent.template.components.find((c: any) => c.sub_type === "url").parameters[0].text).toBe(sb.rows[0].id);
    // rf2's second button is "I have a question": no STOP payload on it, or a tap would opt the buyer out.
    expect(sent.template.components.some((c: any) => c.sub_type === "quick_reply")).toBe(false);
    expect((globalThis.fetch as any).mock.calls).toHaveLength(1);
  });
  it("WHATSAPP_OFF=true (Wati paused) → an opted-in buyer gets SMS, no WhatsApp call", async () => {
    wa(); sms(); vi.stubEnv("WHATSAPP_OFF", "true");
    (globalThis.fetch as any).mockResolvedValue(ok({ type: "success", message: "req1" }));
    const sb = fakeSb();
    const r = await dispatch(sb, msg);
    expect([r.status, r.channel]).toEqual(["sent", "sms"]);
    expect((globalThis.fetch as any).mock.calls).toHaveLength(1);
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe("https://api.msg91.com/api/v5/flow/");
  });
  it("not opted in → SMS only (MSG91 flow, vars cut to 30, fixed link so no link variable)", async () => {
    sms();
    (globalThis.fetch as any).mockResolvedValue(ok({ type: "success", message: "req123" }));
    const sb = fakeSb();
    const r = await dispatch(sb, { ...msg, whatsappOk: false, sms: { key: "CART", vars: ["Priya", "Silver Pomfret Combo 300–400 g cut + White prawns", "Fishtokri", "today, 4–6 PM"] } });
    expect([r.status, r.channel]).toEqual(["sent", "sms"]);
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://api.msg91.com/api/v5/flow/");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ flow_id: "flowcart", sender: "RLFISH", mobiles: "919870619974", var1: "Priya", var3: "Fishtokri", var4: "today, 4-6 PM" });
    expect(body.var5).toBeUndefined();
    expect(body.var2.length).toBeLessThanOrEqual(30);
    expect(sb.rows.map((x) => [x.channel, x.template, x.status, x.provider_id])).toEqual([["sms", "sms:CART", "sent", "req123"]]);
  });
  it("a re-run sends nothing again, on either channel (opt-in changed in between)", async () => {
    sms();
    (globalThis.fetch as any).mockResolvedValue(ok({ type: "success", message: "r" }));
    const sb = fakeSb();
    await dispatch(sb, { ...msg, whatsappOk: false });
    wa();
    expect((await dispatch(sb, msg)).status).toBe("duplicate");
    expect((globalThis.fetch as any).mock.calls).toHaveLength(1);
  });
  it("WhatsApp fails → the same message once by SMS; a promo (no SMS part) doesn't fall back", async () => {
    wa(); sms();
    (globalThis.fetch as any).mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "blocked" } }), { status: 400 }))
      .mockResolvedValueOnce(ok({ type: "success", message: "r" }));
    const sb = fakeSb();
    const r = await dispatch(sb, msg);
    expect(r.channel).toBe("whatsapp:failed,sms:sent");
    expect(sb.rows.map((x) => [x.channel, x.status])).toEqual([["whatsapp", "failed"], ["sms", "sent"]]);
    expect((await dispatch(sb, msg)).status).toBe("duplicate");
    const sb2 = fakeSb();
    (globalThis.fetch as any).mockResolvedValueOnce(new Response("{}", { status: 400 }));
    const promo = { ...msg, dedupe_key: "promo:b1:2026-10-24", kind: "promo", sms: null, smsFallback: false };
    expect((await dispatch(sb2, promo)).channel).toBe("whatsapp");
    expect(sb2.rows).toHaveLength(1);
  });
  it("a WhatsApp row Wati reports failed later → smsFallbackFor sends the SMS once", async () => {
    sms();
    (globalThis.fetch as any).mockResolvedValue(ok({ type: "success", message: "r" }));
    const sb = fakeSb();
    sb.rows.push({ id: "w1", dedupe_key: "act_cart:b1:2026-10-24:whatsapp", channel: "whatsapp", status: "failed", kind: "act_cart", slot_date: "2026-10-24",
      buyer_id: "b1", to_phone: "919870619974", template: "rf2_cart_today", link_path: "/s/fishtokri", payload: { body: msg.body, sms: msg.sms, smsFallback: true, smsOk: true } });
    expect((await smsFallbackFor(sb, sb.rows[0])).status).toBe("sent");
    expect((await smsFallbackFor(sb, sb.rows[0])).status).toBe("duplicate");
    expect(sb.rows.filter((x) => x.channel === "sms")).toHaveLength(1);
    expect((await smsFallbackFor(sb, { ...sb.rows[0], payload: { sms: null } })).status).toBe("no_channel");
  });
  it("no SMS template configured yet → no channel and nothing logged; SMS_LIVE off → dry_run", async () => {
    const sb = fakeSb();
    vi.stubEnv("MSG91_FLOW_CART", "");
    expect((await dispatch(sb, { ...msg, whatsappOk: false })).status).toBe("no_channel");
    expect(sb.rows).toHaveLength(0);
    vi.stubEnv("MSG91_FLOW_CART", "f");
    expect((await dispatch(fakeSb(), { ...msg, whatsappOk: false })).status).toBe("dry_run");
  });
  it("a second marketing WhatsApp the same day (unique index 089) is a duplicate: nothing sent, no SMS", async () => {
    wa(); sms();
    const sb: any = fakeSb();
    sb.from = () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }), upsert: () => ({ select: async () => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"message_log_one_marketing_a_day\"" } }) }) });
    expect(await dispatch(sb, msg)).toEqual({ status: "duplicate", channel: "whatsapp" });
    expect((globalThis.fetch as any).mock.calls).toHaveLength(0);
  });
  it("MESSAGING_TEST_ONLY: only the founder gets real sends", async () => {
    vi.stubEnv("MESSAGING_TEST_ONLY", "9870619974"); wa();
    (globalThis.fetch as any).mockResolvedValue(ok({ messages: [{ id: "w" }] }));
    const sb = fakeSb();
    expect((await dispatch(sb, { ...msg, buyer_id: "b2", phone: "9820138553", dedupe_key: "x" })).status).toBe("dry_run");
    expect((await dispatch(sb, msg)).status).toBe("sent");
    expect((globalThis.fetch as any).mock.calls).toHaveLength(1);
  });
});

describe("SMS (MSG91)", () => {
  it("every DLT text ends in \" - Relifish\", links only to a whitelisted static URL, has 1–4 variables and no seller name", () => {
    for (const [k, t] of Object.entries(SMS_TEXT)) {
      expect(t, k).toMatch(/ - Relifish$/);
      for (const u of t.match(/https?:\/\/\S+/g) || []) expect(u, k).toMatch(/^https:\/\/www\.relifish\.com\/(shop|track|orders)$/);
      expect(t, k).not.toMatch(/Fishtokri|Nomadic/);
      expect(smsVarCount(k as any), k).toBeGreaterThanOrEqual(1);
      expect(smsVarCount(k as any), k).toBeLessThanOrEqual(4);
    }
  });
  it("the MSG91 body names var1…varN, cuts to 30 and writes ₹ as Rs.", () => {
    const b: any = smsPayload("f1", "919870619974", ["#3F9A21C0", "seller couldn't take it", "₹1,230 in 5-7 working days"]);
    expect(b.var3).toBe("Rs.1,230 in 5-7 working days");
    expect(b.var4).toBeUndefined();
    expect(b.flow_id).toBe("f1");
  });
  it("order updates fill exactly the SMS variables their template has, each ≤ 30 chars after cutting", () => {
    const ord = { id: "1b26326f-948a-4c56", species: "pomfret", delivery_slot_start: "2026-10-31T02:30:00Z", delivery_slot_end: "2026-10-31T04:30:00Z",
      listing: { description: "Silver Pomfret · Cut pcs + head & tail", species: "pomfret", seller: { name: "Fishtokri" } } };
    for (const ev of ["unpaid", "paid", "confirmed", "out_for_delivery", "completed", "cancelled"] as OrderWaEvent[]) {
      const s = orderSms(ev, ord, "kunal rawat", { reason: "Not available.", refund: "₹285, started today, reaches your account in 5–7 working days" });
      expect(s.vars.length, ev).toBe(smsVarCount(s.key));
      for (const v of s.vars) expect(cut30(v).length).toBeLessThanOrEqual(30);
    }
    expect(orderSms("cancelled", ord, "kunal", { reason: "x.", refund: "₹285, started today" })).toEqual({ key: "CANCELLED", vars: ["Kunal", "#1B26326F", "x", "₹285"] });
    expect(orderSms("cancelled", ord, "kunal", { reason: "x", refund: "none needed, nothing was charged" })).toEqual({ key: "CANCELLED_NOPAY", vars: ["Kunal", "#1B26326F", "x"] });
    // No seller name in any order SMS (founder, 1 Nov).
    expect(orderSms("confirmed", ord, "kunal").vars[0]).toBe("Kunal");
    expect(cut30("a".repeat(40))).toHaveLength(30);
  });
  it("rf2_cancelled goes out on Wati as the utility copy rfw_cancelled_u", () => {
    expect(watiTemplate({ to: "1", name: "rf2_cancelled", body: [] })).toBe("rfw_cancelled_u");
  });
});

describe("Wati provider", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("maps rf2 templates to Wati names and params: photo, text-only and no-header", () => {
    const conf = { to: "919870619974", name: "rf2_confirmed", body: ["Fishtokri", "#AB12", "Fri 8–10 AM"], urlSuffix: "abc" };
    expect(watiTemplate({ ...conf, headerImage: "https://x/p.jpg" })).toBe("rfw2_confirmed");
    expect(watiParams({ ...conf, headerImage: "https://x/p.jpg" })).toEqual([{ name: "image_url", value: "https://x/p.jpg" }, { name: "1", value: "Fishtokri" }, { name: "2", value: "#AB12" }, { name: "3", value: "Fri 8–10 AM" }, { name: "4", value: "abc" }]);
    expect(watiTemplate({ ...conf, headerImage: null })).toBe("rfwt_confirmed");
    expect(watiParams({ ...conf, headerImage: null }).map((p) => p.name)).toEqual(["1", "2", "3", "4"]);
    expect(watiTemplate({ to: "1", name: "rf2_out", body: ["#AB12", "2 PM"] })).toBe("rfw_out");
    expect(watiTemplate({ to: "1", name: "rf_hello", body: ["Kiran"] })).toBe("rfw_hello");
  });
  it("is live only with Wati keys, and still honours dry-run and the test-only list", () => {
    vi.stubEnv("WA_PROVIDER", "wati");
    vi.stubEnv("WA_PHONE_NUMBER_ID", ""); vi.stubEnv("WA_TOKEN", "");
    vi.stubEnv("WATI_API_URL", ""); vi.stubEnv("WATI_API_KEY", "");
    expect(isLiveFor("919870619974")).toBe(false);
    vi.stubEnv("WATI_API_URL", "https://x/10282905"); vi.stubEnv("WATI_API_KEY", "k");
    vi.stubEnv("WA_TEST_ONLY", "919870619974"); vi.stubEnv("WA_DRY_RUN", "");
    expect(isLiveFor("919870619974")).toBe(true);
    expect(isLiveFor("919999999999")).toBe(false);
    vi.stubEnv("WA_DRY_RUN", "true");
    expect(isLiveFor("919870619974")).toBe(false);
  });
});

describe("Wati status read-back", () => {
  // Real getMessages items (30 Oct 2026), trimmed.
  const item = (id: string, tpl: string, created: string, status: string, failedDetail = "") =>
    ({ id, eventType: "broadcastMessage", eventDescription: `Broadcast message with using "${tpl}" template was received 30|10|2026`, created, statusString: status, failedDetail });
  const items = [
    item("a", "rfw2_unpaid", "2026-10-30T04:30:02Z", "FAILED", "Message undeliverable as Meta has restricted it for higher quality messaging - retry again in a few days"),
    item("b", "rfw2_unpaid", "2026-10-30T04:31:33Z", "DELIVERED"),
    item("c", "rfwt_order_again", "2026-10-30T07:59:47.88Z", "FAILED"),
    { id: "m", eventType: "message", text: "hi", created: "2026-10-30T05:00:00Z" },
  ];
  it("matches the same template (photo or text-only) sent after our row, each item once", () => {
    expect(matchWatiItem(items, "rf2_unpaid", "2026-10-30T04:30:00Z")?.id).toBe("a");
    expect(matchWatiItem(items, "rf2_unpaid", "2026-10-30T04:31:30Z")?.id).toBe("b"); // not checkout A's earlier message
    expect(matchWatiItem(items, "rf2_unpaid", "2026-10-30T04:30:00Z", new Set(["a"]))?.id).toBe("b");
    expect(matchWatiItem(items, "rf2_order_again", "2026-10-30T07:59:40Z")?.id).toBe("c");
    expect(matchWatiItem(items, "rf2_cart_today", "2026-10-30T04:00:00Z")).toBeNull();
  });
  it("status only moves forward; failed is final", () => {
    expect(nextStatus("sent", { statusString: "READ" })).toBe("read");
    expect(nextStatus("read", { statusString: "DELIVERED" })).toBeNull();
    expect(nextStatus("delivered", { statusString: "FAILED" })).toBe("failed");
    expect(nextStatus("failed", { statusString: "READ" })).toBeNull();
  });
});

describe("buyer order updates (founder 31 Oct)", () => {
  it("only seller-confirmed, out-for-delivery and cancelled/refund reach the buyer", async () => {
    const { BUYER_ORDER_EVENTS } = await import("../../src/lib/server/notify-order-whatsapp");
    expect([...BUYER_ORDER_EVENTS].sort()).toEqual(["cancelled", "confirmed", "out_for_delivery"]);
  });
});

// ── The messaging cron route against an in-memory database ──
vi.mock("@supabase/supabase-js", () => ({ createClient: () => (globalThis as any).__cronDb }));
/** Minimal PostgREST stand-in: eq/lt/gte/in/is/not filters, update/upsert, the awaited result. Embedded joins are pre-joined in the rows. */
function fakeDb(t: Record<string, any[]>) {
  let n = 0;
  const from = (table: string) => {
    const rows = (t[table] ||= []);
    const f: ((r: any) => boolean)[] = [];
    let write: any = null, one = false;
    const b: any = {
      select: () => b, order: () => b, or: () => b, limit: () => b, range: () => b,
      eq: (c: string, v: any) => (f.push((r) => r[c] === v), b),
      lt: (c: string, v: any) => (f.push((r) => r[c] < v), b),
      gte: (c: string, v: any) => (f.push((r) => r[c] >= v), b),
      gt: (c: string, v: any) => (f.push((r) => r[c] > v), b),
      in: (c: string, v: any[]) => (f.push((r) => v.includes(r[c])), b),
      is: (c: string, v: any) => (f.push((r) => (r[c] ?? null) === v), b),
      not: (c: string, _op: string, v: any) => (f.push((r) => (r[c] ?? null) !== v), b),
      update: (patch: any) => ((write = patch), b),
      maybeSingle: () => ((one = true), b),
      upsert: (row: any) => ({ select: async () => {
        if (rows.some((r) => r.dedupe_key === row.dedupe_key)) return { data: [], error: null };
        const r = { created_at: new Date().toISOString(), ...row, id: `row${++n}`, short_id: `s${n}` }; rows.push(r); return { data: [r], error: null };
      } }),
      then: (res: any, rej: any) => {
        const hit = rows.filter((r) => f.every((p) => p(r)));
        if (write) hit.forEach((r) => Object.assign(r, write));
        return Promise.resolve({ data: one ? hit[0] ?? null : hit, error: null }).then(res, rej);
      },
    };
    return b;
  };
  return { from, t };
}
const SELLER_ROW = {
  id: "ft", name: "Fishtokri", phone: "9800000001", lat: 19.1906444, lng: 72.9791824, delivery_rad: 7, is_test: false, is_active: true,
  opens_at: "08:00:00", closes_at: "18:00:00", open_days: ["tue", "wed", "thu", "fri", "sat", "sun"], accepts_preorder: true,
  preorder_days: ["mon", "tue", "wed", "thu", "fri", "sat"], preorder_opens_at: null, preorder_cutoff_time: "03:00:00", delivery_days: null,
  delivery_slots_enabled: true, delivery_slot_minutes: 120, preorder_delivery_start: "08:00:00", preorder_delivery_end: "18:00:00", preorder_days_ahead: 3,
};
const FRI_11 = Date.parse("2026-10-23T11:00:00+05:30");
const buyerRow = (phone: string, x: any = {}) => ({ id: `b${phone.slice(-4)}`, phone, first_name: "Priya", created_at: new Date(FRI_11 - 61 * 60_000).toISOString(),
  lat: 19.2, lng: 72.97, is_test: false, whatsapp_opt_in_at: "2026-10-01T00:00:00Z", whatsapp_opt_out_at: null, dnd_at: null, ...x });
async function cron(t: Record<string, any[]>, query = `dry_run=1&now=${new Date(FRI_11).toISOString()}`) {
  vi.stubEnv("CRON_SECRET", "s"); vi.stubEnv("WA_PROVIDER", "");
  const db = fakeDb({ sellers: [SELLER_ROW], buyers: [], buyer_cart: [], orders: [], message_log: [], fish_listings: [], cron_lock: [{ name: "messaging", until: "2000-01-01T00:00:00Z" }], ...t });
  (globalThis as any).__cronDb = db;
  const { GET } = await import("../../src/pages/api/cron/messaging");
  const res = await GET({ request: new Request("http://x", { headers: { authorization: "Bearer s" } }), url: new URL(`http://x/api/cron/messaging?${query}`) } as any);
  return { body: await (res as Response).json(), db };
}

describe("messaging cron", () => {
  it("a switched-off seller's phone gets no buyer messages", async () => {
    const { body } = await cron({
      sellers: [SELLER_ROW, { ...SELLER_ROW, id: "off", phone: "9800003218", is_active: false }],
      buyers: [buyerRow("9800003218"), buyerRow("9800007777")],
    });
    expect(body.messages.map((m: any) => m.buyer)).toEqual(["…7777"]);
  });
  it("a cart line the cart itself would drop (pack size gone) isn't named as waiting in the cart", async () => {
    const listing = { seller_id: "ft", species: "pomfret", description: "Khapri Pomfret · Cut pcs", photo_url: "https://x/k.jpg", pricing_options: [{ id: "o2", label: "500–600 g", price: 1220 }],
      is_available: true, is_preorder_enabled: true, is_order_paused: false, weight_avail: null, deleted_at: null };
    const line = (opt: string) => ({ id: "c1", buyer_id: "b7777", pricing_option_id: opt, placement_kind: "same_day", qty: 1, updated_at: new Date(FRI_11 - 60 * 60_000).toISOString(), listing });
    expect((await cron({ buyers: [buyerRow("9800007777")], buyer_cart: [line("o2")] })).body.messages.map((m: any) => m.template)).toEqual(["rf2_cart_today"]);
    expect((await cron({ buyers: [buyerRow("9800007777")], buyer_cart: [line("o1")] })).body.messages).toEqual([]);
  });
  it("SMS fallback: only a reminder that is still true, in send hours and < 60 min old; never a stuck row", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(FRI_11);
    vi.stubEnv("MESSAGING_LIVE", "true"); for (const k of ["UNPAID", "CART", "CONFIRMED"]) vi.stubEnv(`MSG91_FLOW_${k}`, "f");
    const ago = (min: number) => new Date(FRI_11 - min * 60_000).toISOString();
    const row = (phone: string, kind: string, min: number, x: any = {}) => ({ id: `w${phone}`, dedupe_key: `${kind}:${phone}:whatsapp`, channel: "whatsapp", status: "failed", error: "Message undeliverable",
      kind, slot_date: "2026-10-23", to_phone: `91980000${phone}`, buyer_id: `b${phone}`, template: "rf2_x", link_path: "/x", created_at: ago(min),
      payload: { body: [], sms: { key: kind === "act_unpaid" ? "UNPAID" : kind === "act_cart" ? "CART" : "CONFIRMED", vars: ["a"] }, smsFallback: true, smsOk: true }, ...x });
    const { body } = await cron({
      message_log: [
        row("0001", "act_unpaid", 20, { order_id: "o1" }), row("0002", "act_unpaid", 20, { order_id: "o2" }),
        row("0003", "act_cart", 20), row("0004", "act_cart", 90),
        row("0005", "order_confirmed", 30, { error: "stuck in queue: no send result" }), row("0006", "order_confirmed", 180),
      ],
      orders: [{ id: "o1", status: "pending_payment", created_at: ago(50) }, { id: "o2", status: "pending_payment", razorpay_payment_id: "pay_1", created_at: ago(50) },
        { id: "o3", buyer_id: "b0003", status: "paid", created_at: ago(10) }],
    }, "");
    vi.useRealTimers();
    expect(body.sync.sms_fallback.map((x: any) => [x.buyer, x.kind])).toEqual([["…0001", "act_unpaid"], ["…0006", "order_confirmed"]]);
  });
  it("a buyer who signed up over 60 days ago still gets the cart reminder for a new cart", async () => {
    const listing = { seller_id: "ft", species: "bombil", description: "Bombil", photo_url: null, pricing_options: [{ price: 240 }], is_available: true, is_preorder_enabled: true, deleted_at: null };
    const { body } = await cron({
      buyers: [buyerRow("9800007777", { created_at: "2026-07-01T10:00:00Z" })],
      buyer_cart: [{ id: "c1", buyer_id: "b7777", pricing_option_id: "", placement_kind: "same_day", qty: 1, updated_at: new Date(FRI_11 - 60 * 60_000).toISOString(), listing }],
    });
    expect(body.messages.map((m: any) => m.template)).toEqual(["rf2_cart_today"]);
  });
  it("a live run skips while another holds the lock, and releases its own when done", async () => {
    vi.stubEnv("MESSAGING_LIVE", "true");
    const held = await cron({ cron_lock: [{ name: "messaging", until: new Date(Date.now() + 5 * 60_000).toISOString() }] }, "");
    expect(held.body).toEqual({ skipped: "another run in progress" });
    const free = await cron({}, "");
    expect(free.body.dry).toBe(false);
    expect(Date.parse(free.db.t.cron_lock[0].until)).toBeLessThanOrEqual(Date.now());
  });
});

describe("promotional SMS sending (founder, 1 Nov)", () => {
  const ok = (body: any) => new Response(JSON.stringify(body), { status: 200 });
  const base = () => { vi.stubEnv("SMS_LIVE", "true"); vi.stubEnv("MSG91_AUTH_KEY", "k"); vi.stubEnv("MSG91_FLOW_PROMO_NEW", "flowpromo"); vi.stubEnv("MSG91_SENDER_ID", "RLFISH"); };
  const msg = { dedupe_key: "promo:b1:2026-11-07", kind: "promo", slot_date: "2026-11-07", buyer_id: "b1", phone: "9870619974", whatsappOk: false,
    template: "rf2_catch_prices", body: [], link_path: "/shop", sms: { key: "PROMO_NEW" as const, vars: ["Priya", "Surmai, Pomfret", "4 PM", "today, 4–6 PM"] }, smsOk: true, smsFallback: false };
  it("is off unless PROMO_SMS_LIVE=true and a promo header is set: nothing logged, nothing sent", async () => {
    base();
    const sb = fakeSb();
    expect(smsReady("PROMO_NEW")).toBe(false);
    expect((await dispatch(sb, msg)).status).toBe("no_channel");
    vi.stubEnv("PROMO_SMS_LIVE", "true");
    expect(smsReady("PROMO_NEW")).toBe(false); // still no MSG91_PROMO_SENDER
    expect(sb.rows).toHaveLength(0);
    expect((globalThis.fetch as any).mock.calls).toHaveLength(0);
  });
  it("sends from the numeric promo header, not RLFISH; reminders keep RLFISH", async () => {
    base(); vi.stubEnv("PROMO_SMS_LIVE", "true"); vi.stubEnv("MSG91_PROMO_SENDER", "873543");
    (globalThis.fetch as any).mockResolvedValue(ok({ type: "success", message: "p1" }));
    const sb = fakeSb();
    const r = await dispatch(sb, msg);
    expect([r.status, r.channel]).toEqual(["sent", "sms"]);
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body).toMatchObject({ flow_id: "flowpromo", sender: "873543", var1: "Priya", var3: "4 PM", var4: "today, 4-6 PM" });
    expect(smsPayload("f", "91x", ["a"]).sender).toBe("RLFISH");
  });
  it("a promo goes once: a second run is a duplicate", async () => {
    base(); vi.stubEnv("PROMO_SMS_LIVE", "true"); vi.stubEnv("MSG91_PROMO_SENDER", "873543");
    (globalThis.fetch as any).mockResolvedValue(ok({ type: "success", message: "p1" }));
    const sb = fakeSb();
    await dispatch(sb, msg);
    expect((await dispatch(sb, msg)).status).toBe("duplicate");
    expect((globalThis.fetch as any).mock.calls).toHaveLength(1);
  });
  it("every promo template: gentle, whitelisted link, ≤4 variables, no prices or seller names", () => {
    for (const k of ["PROMO_NEW", "PROMO_CART", "PROMO_AGAIN"] as const) {
      const t = SMS_TEXT[k];
      expect(t, k).toMatch(/ - Relifish$/);
      expect(t, k).not.toMatch(/₹|discount|offer|hurry|last chance|pay now|not paid/i);
      expect(smsVarCount(k)).toBeLessThanOrEqual(4);
    }
  });
});

describe("DB weekly SMS cap (migration 091)", () => {
  it("a refused insert is 'capped': nothing sent, not an error", async () => {
    vi.stubEnv("SMS_LIVE", "true"); vi.stubEnv("MSG91_AUTH_KEY", "k"); vi.stubEnv("MSG91_FLOW_CART", "f");
    const sb: any = { from: () => ({ select: () => ({ in: async () => ({ data: [] }) }),
      upsert: () => ({ select: async () => ({ data: null, error: { code: "P0001", message: "sms_weekly_cap: 9974 already has 2 reminder/promo SMS in the last 7 days" } }) }) }) };
    const r = await dispatch(sb, { dedupe_key: "act_cart:b:1", kind: "act_cart", slot_date: "x", phone: "9870619974", whatsappOk: false, template: "t", body: [], link_path: "/", sms: { key: "CART", vars: ["a", "b"] } });
    expect(r.status).toBe("capped");
    expect((globalThis.fetch as any).mock.calls).toHaveLength(0);
  });
});
