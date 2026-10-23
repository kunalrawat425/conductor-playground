import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: any[] = [];
vi.mock("../../src/lib/server/load-web-push", () => ({
  PUSH_SEND_OPTIONS: {},
  loadWebPush: async () => ({ setVapidDetails: () => {}, sendNotification: async (_s: any, body: string) => { sent.push(JSON.parse(body)); } }),
}));
vi.mock("../../src/lib/server/resolve-buyer-push-id", () => ({ resolveBuyerIdForPush: async () => "buyer-1" }));
vi.mock("../../src/lib/server/vapid-env", () => ({ normalizeVapidKeyForWebPush: (k: string) => k || "k", trimVapidKey: (k: string) => k }));
vi.mock("@supabase/supabase-js", () => {
  const q: any = {
    select: () => q, eq: () => q, update: () => q, insert: async () => ({}),
    single: async () => ({ data: { push_subscription: { endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" } }, push_enabled: true } }),
    then: (r: any) => r({}),
  };
  return { createClient: () => ({ from: () => q }) };
});

import { sendBuyerOrderPush } from "../../src/lib/server/buyer-push";

describe("buyer order push picture", () => {
  beforeEach(() => { sent.length = 0; process.env.VAPID_PRIVATE_KEY = "x"; process.env.PUBLIC_VAPID_KEY = "y"; });

  it("Order Confirmed carries the fish photo as an absolute URL", async () => {
    const r = await sendBuyerOrderPush({ buyer_id: "buyer-1", status: "confirmed", species: "rawas", order_id: "o1", slot: { when: "Sat 24 Oct, 8–10 AM" } });
    expect(r.sent).toBe(true);
    expect(sent[0].title).toBe("Order Confirmed!");
    expect(sent[0].image).toMatch(/^https?:\/\/.+\/fish\/rawas\.jpg$/);
    expect(sent[0].url).toMatch(/\/track\/o1$/);
  });

  it("other steps go out without a picture", async () => {
    await sendBuyerOrderPush({ buyer_id: "buyer-1", status: "out_for_delivery", species: "rawas", order_id: "o1" });
    expect(sent[0].image).toBeUndefined();
  });
});
