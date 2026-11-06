import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AISENSY_URL, aisensyPayload, isLiveFor, sendTemplate } from "../../src/lib/server/whatsapp";
import { dispatch } from "../../src/lib/server/messaging";
import { POST } from "../../src/pages/api/aisensy/webhook";

const conf = { to: "919870619974", name: "rf2_confirmed", body: ["Fishtokri", "#AB12", "Fri 8–10 AM"], urlSuffix: "abc" };
const live = () => { vi.stubEnv("WA_PROVIDER", "aisensy"); vi.stubEnv("AISENSY_API_KEY", "k"); vi.stubEnv("WA_DRY_RUN", ""); vi.stubEnv("WA_TEST_ONLY", ""); };
const res = (body: any, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("AiSensy provider (WA_PROVIDER=aisensy)", () => {
  it("payload: campaign = template name, photo as media, text-only copy without, URL suffix as button", () => {
    const p = aisensyPayload({ ...conf, headerImage: "https://x/p.jpg" }, "k");
    expect(p).toMatchObject({ apiKey: "k", campaignName: "rfw2_confirmed", destination: "919870619974", templateParams: ["Fishtokri", "#AB12", "Fri 8–10 AM"], media: { url: "https://x/p.jpg" } });
    expect(p.buttons?.[0].parameters[0].text).toBe("abc");
    const t = aisensyPayload({ ...conf, headerImage: null }, "k");
    expect([t.campaignName, "media" in t]).toEqual(["rfwt_confirmed", false]);
    expect(aisensyPayload({ to: "1", name: "rf2_cancelled", body: [] }, "k").campaignName).toBe("rfw_cancelled_u");
  });
  it("live only with AISENSY_API_KEY; dry-run and test-only still apply", () => {
    vi.stubEnv("WA_PROVIDER", "aisensy"); vi.stubEnv("AISENSY_API_KEY", ""); vi.stubEnv("WA_PHONE_NUMBER_ID", "1"); vi.stubEnv("WA_TOKEN", "t");
    expect(isLiveFor("919870619974")).toBe(false);
    live(); vi.stubEnv("WA_TEST_ONLY", "919870619974");
    expect(isLiveFor("919870619974")).toBe(true);
    expect(isLiveFor("919999999999")).toBe(false);
    vi.stubEnv("WA_DRY_RUN", "true");
    expect(isLiveFor("919870619974")).toBe(false);
  });
  it("sent only on 2xx + success; error body, HTTP error or network error → failed", async () => {
    live();
    const f = globalThis.fetch as any;
    f.mockResolvedValueOnce(res({ success: "true", submitted_message_id: "m1" }));
    expect(await sendTemplate(conf)).toEqual({ status: "sent", id: "m1" });
    expect(f.mock.calls[0][0]).toBe(AISENSY_URL);
    f.mockResolvedValueOnce(res({ success: false, message: "Campaign not live" }));
    expect((await sendTemplate(conf)).status).toBe("failed");
    f.mockResolvedValueOnce(res({ message: "Invalid params" }, 400));
    expect((await sendTemplate(conf)).status).toBe("failed");
    f.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect((await sendTemplate(conf)).status).toBe("failed");
  });
  it("a rejected AiSensy send (no campaign / template not approved) falls back to SMS once", async () => {
    live(); vi.stubEnv("SMS_LIVE", "true"); vi.stubEnv("MSG91_AUTH_KEY", "k"); vi.stubEnv("MSG91_FLOW_CART", "flowcart");
    (globalThis.fetch as any).mockResolvedValueOnce(res({ success: false, message: "Campaign does not exist" }, 400))
      .mockResolvedValueOnce(res({ type: "success", message: "r" }));
    const rows: any[] = [];
    let n = 0;
    const sb = { from: () => ({
      select: () => ({ in: async (_k: string, keys: string[]) => ({ data: rows.filter((r) => keys.includes(r.dedupe_key)), error: null }) }),
      upsert: (row: any) => ({ select: async () => { const r = { ...row, id: `00000000-0000-4000-8000-00000000000${++n}`, short_id: `s${n}` }; rows.push(r); return { data: [r], error: null }; } }),
      update: (patch: any) => ({ eq: async (_k: string, id: string) => { Object.assign(rows.find((r) => r.id === id) || {}, patch); return {}; } }),
    }) };
    const r = await dispatch(sb, { dedupe_key: "act_cart:b1:2026-11-07", kind: "act_cart", slot_date: "2026-11-07", buyer_id: "b1", phone: "9870619974", whatsappOk: true,
      template: "rf2_cart_today", body: ["Priya", "Rawas", "Fishtokri", "today, 4–6 PM"], headerImage: "https://x/r.jpg", link_path: "/s/fishtokri",
      sms: { key: "CART", vars: ["Priya", "Rawas", "Fishtokri", "today, 4–6 PM"] }, smsFallback: true } as any);
    expect(r.channel).toBe("whatsapp:failed,sms:sent");
    expect(rows.map((x) => [x.channel, x.status])).toEqual([["whatsapp", "failed"], ["sms", "sent"]]);
  });
});

describe("AiSensy webhook", () => {
  const call = (q: string) => POST({ request: new Request(`https://x/api/aisensy/webhook${q}`, { method: "POST", body: JSON.stringify({ topic: "message.status.updated" }) }), url: new URL(`https://x/api/aisensy/webhook${q}`) } as any);
  it("403 without the key or when none is configured, 200 with it", async () => {
    vi.stubEnv("AISENSY_WEBHOOK_KEY", "");
    expect((await call("?key=")).status).toBe(403);
    vi.stubEnv("AISENSY_WEBHOOK_KEY", "s3cret");
    expect((await call("?key=nope")).status).toBe(403);
    expect((await call("?key=s3cret")).status).toBe(200);
  });
});
