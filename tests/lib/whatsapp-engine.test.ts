import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLiveFor, templatePayload, validWebhookSignature, waNumber, watiPayload } from "../../src/lib/server/whatsapp";
import { TEMPLATES, templateProblems, headerImage, fishPhoto, fishName, firstName, SIGNUP_IMAGE, rotationImage, varCount } from "../../src/lib/messaging/templates";
import { orderMessage, type OrderWaEvent } from "../../src/lib/server/notify-order-whatsapp";

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
};
/** rf_* strings in src that are not WhatsApp templates. */
const NOT_TEMPLATES = new Set(["rf_internal", "rf_utm", "rf_resume_checkout"]);
const srcFiles = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? srcFiles(p) : [p];
});

const pushes: any[] = [];
vi.mock("../../src/lib/server/buyer-push", () => ({
  sendCustomBuyerPush: async (id: string, n: any, path: string) => { pushes.push({ id, n, path }); return { ok: true, sent: true }; },
}));
import { dispatch } from "../../src/lib/server/messaging";

/** Tiny in-memory message_log with the unique dedupe_key the migration creates. */
function fakeSb() {
  const rows: any[] = [];
  let n = 0;
  return {
    rows,
    from: () => ({
      upsert: (row: any) => ({
        select: async () => {
          if (rows.some((r) => r.dedupe_key === row.dedupe_key)) return { data: [], error: null };
          const r = { ...row, id: `00000000-0000-4000-8000-00000000000${++n}` }; rows.push(r); return { data: [{ id: r.id }], error: null };
        },
      }),
      update: (patch: any) => ({ eq: async (_k: string, id: string) => { Object.assign(rows.find((r) => r.id === id) || {}, patch); return {}; } }),
    }),
  };
}

beforeEach(() => { pushes.length = 0; vi.stubGlobal("fetch", vi.fn()); });
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
  it("mirror the 19 approved rf2 templates (category, header, variable count) and pass Meta + brand checks", () => {
    expect(Object.fromEntries(TEMPLATES.map((t) => [t.name, [t.category, t.header === "IMAGE", t.body.match(/\{\{\d+\}\}/g)?.length ?? 0]]))).toEqual(APPROVED);
    for (const t of TEMPLATES) expect(templateProblems(t), t.name).toEqual([]);
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
    expect(orderMessage("completed", ord, "manoj", noon).body).toEqual(["Silver Pomfret", "Manoj", "Fishtokri"]);
    expect(orderMessage("cancelled", ord, "manoj", noon, { reason: "the seller ran out of pomfret today", refund: "₹1,380, started today, reaches your account in 5–7 working days" }).body)
      .toEqual(["Manoj", "#EEB0F7AC", "the seller ran out of pomfret today", "₹1,380, started today, reaches your account in 5–7 working days"]);
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
  it("no-cart offers rotate the fish: surmai, pomfret, crab…", () => {
    expect([0, 1, 2].map(rotationImage).map((u) => u.split("/").pop())).toEqual(["surmai.jpg", "pomfret.jpg", "crab.jpg"]);
    expect(rotationImage(6)).toMatch(/surmai\.jpg$/);
  });
  it("header photo: their listing photo, else our fish photo, else the poster", () => {
    expect(headerImage("https://x/cut-pomfret.jpg", "pomfret")).toBe("https://x/cut-pomfret.jpg");
    expect(headerImage(null, "rawas")).toMatch(/\/fish\/rawas\.jpg$/);
    expect(headerImage(null, "bombil")).toBe(SIGNUP_IMAGE);
    expect(fishPhoto("Seawater red prawns")).toMatch(/prawns\.jpg$/);
  });
});

describe("dispatch: both channels, once", () => {
  const msg = { dedupe_key: "B1:b1:2026-10-24", kind: "B1", slot_date: "2026-10-24", buyer_id: "b1", phone: "9870619974", whatsappOk: true,
    template: "rf2_cart_today", body: ["Priya", "Baby Rawas", "Fishtokri", "today, 4–6 PM"], headerImage: "https://x/r.jpg", link_path: "/s/fishtokri", push: { title: "t", body: "b" } };
  it("sends WhatsApp AND push, each logged, with /go/<id> links", async () => {
    vi.stubEnv("WA_PHONE_NUMBER_ID", "123"); vi.stubEnv("WA_TOKEN", "tok");
    (globalThis.fetch as any).mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 }));
    const sb = fakeSb();
    const r = await dispatch(sb, msg);
    expect(r.channel).toBe("whatsapp:sent,push:sent");
    expect(sb.rows.map((x) => [x.channel, x.status, x.dedupe_key])).toEqual([
      ["whatsapp", "sent", "B1:b1:2026-10-24:whatsapp"], ["push", "sent", "B1:b1:2026-10-24:push"]]);
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(sent.template.components.find((c: any) => c.sub_type === "url").parameters[0].text).toBe(sb.rows[0].id);
    // rf2's second button is "I have a question": no STOP payload on it, or a tap would opt the buyer out.
    expect(sent.template.components.some((c: any) => c.sub_type === "quick_reply")).toBe(false);
    expect(pushes[0].path).toBe(`/go/${sb.rows[1].id}`);
  });
  it("a re-run sends nothing again", async () => {
    vi.stubEnv("WA_PHONE_NUMBER_ID", "123"); vi.stubEnv("WA_TOKEN", "tok");
    (globalThis.fetch as any).mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "w" }] }), { status: 200 }));
    const sb = fakeSb();
    await dispatch(sb, msg);
    const again = await dispatch(sb, msg);
    expect(again.status).toBe("duplicate");
    expect((globalThis.fetch as any).mock.calls).toHaveLength(1);
    expect(pushes).toHaveLength(1);
  });
  it("no WhatsApp consent → push only; no token → WhatsApp is dry_run", async () => {
    const sb = fakeSb();
    expect((await dispatch(sb, { ...msg, whatsappOk: false })).channel).toBe("push:sent");
    const sb2 = fakeSb();
    expect((await dispatch(sb2, msg)).channel).toBe("whatsapp:dry_run,push:sent");
  });
  it("MESSAGING_TEST_ONLY: only the founder gets real sends", async () => {
    vi.stubEnv("MESSAGING_TEST_ONLY", "9870619974"); vi.stubEnv("WA_PHONE_NUMBER_ID", "123"); vi.stubEnv("WA_TOKEN", "tok");
    (globalThis.fetch as any).mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "w" }] }), { status: 200 }));
    const sb = fakeSb();
    expect((await dispatch(sb, { ...msg, buyer_id: "b2", phone: "9820138553", dedupe_key: "x" })).channel).toBe("whatsapp:dry_run,push:dry_run");
    expect(pushes).toHaveLength(0);
    expect((await dispatch(sb, msg)).channel).toBe("whatsapp:sent,push:sent");
  });
});

describe("Wati provider", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("maps body vars to custom_params 1, 2, 3 in order", () => {
    expect(watiPayload({ to: "919870619974", name: "rf2_out", body: ["#AB12", "2 PM"] })).toEqual({
      template_name: "rf2_out", broadcast_name: "rf_rf2_out",
      recipients: [{ phone_number: "919870619974", custom_params: [{ name: "1", value: "#AB12" }, { name: "2", value: "2 PM" }] }],
    });
  });
  it("is live only with Wati keys, and still honours dry-run and the test-only list", () => {
    vi.stubEnv("WA_PROVIDER", "wati");
    vi.stubEnv("WA_PHONE_NUMBER_ID", ""); vi.stubEnv("WA_TOKEN", "");
    vi.stubEnv("WATI_BASE_URL", ""); vi.stubEnv("WATI_API_KEY", "");
    expect(isLiveFor("919870619974")).toBe(false);
    vi.stubEnv("WATI_BASE_URL", "https://x/api/ext/v3"); vi.stubEnv("WATI_API_KEY", "k");
    vi.stubEnv("WA_TEST_ONLY", "919870619974"); vi.stubEnv("WA_DRY_RUN", "");
    expect(isLiveFor("919870619974")).toBe(true);
    expect(isLiveFor("919999999999")).toBe(false);
    vi.stubEnv("WA_DRY_RUN", "true");
    expect(isLiveFor("919870619974")).toBe(false);
  });
});
