import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { templatePayload, validWebhookSignature, waNumber } from "../../src/lib/server/whatsapp";
import { TEMPLATES, templateProblems, promoImage, fishPhoto } from "../../src/lib/messaging/templates";

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
    const p = templatePayload({ to: "919870619974", name: "rf_cart_today", headerImage: "https://x/fish.jpg", body: ["Baby Rawas"], urlSuffix: "abc", quickReplyPayload: "STOP" });
    expect(p.template.components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://x/fish.jpg" } }] },
      { type: "body", parameters: [{ type: "text", text: "Baby Rawas" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "abc" }] },
      { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "STOP" }] },
    ]);
    expect(p).toMatchObject({ messaging_product: "whatsapp", to: "919870619974", type: "template", template: { name: "rf_cart_today", language: { code: "en" } } });
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
  it("all 12 pass Meta + brand checks", () => {
    expect(TEMPLATES).toHaveLength(12);
    for (const t of TEMPLATES) expect(templateProblems(t), t.name).toEqual([]);
  });
  it("catch a price, a trailing variable and a promo in a utility template", () => {
    const base = TEMPLATES[0];
    expect(templateProblems({ ...base, body: "Pomfret at ₹400 today." })[0]).toMatch(/brand/);
    expect(templateProblems({ ...base, body: "Get it on {{1}}", examples: ["x"] })).toContain("variable at start or end of body");
    expect(templateProblems({ ...TEMPLATES[4], body: "Big sale on order {{1}} now.", examples: ["x"] })).toContain("promo wording in a utility template");
  });
  it("header photo: their fish, else a different fish each day", () => {
    expect(promoImage("rawas", "2026-10-24")).toMatch(/\/fish\/rawas\.jpg$/);
    expect(promoImage("bombil", "2026-10-24")).toMatch(/\/fish\/(pomfret|surmai|rawas|prawns)\.jpg$/);
    expect(promoImage(null, "2026-10-24")).not.toBe(promoImage(null, "2026-10-25"));
    expect(fishPhoto("Seawater red prawns")).toMatch(/prawns\.jpg$/);
  });
});

describe("dispatch: both channels, once", () => {
  const msg = { dedupe_key: "B1:b1:2026-10-24", kind: "B1", slot_date: "2026-10-24", buyer_id: "b1", phone: "9870619974", whatsappOk: true,
    template: "rf_cart_today", body: ["Baby Rawas"], headerImage: "https://x/r.jpg", link_path: "/s/fishtokri", push: { title: "t", body: "b" } };
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
