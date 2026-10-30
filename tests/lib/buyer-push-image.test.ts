import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: any[] = [];
// The checkout behind order o1: the costliest live item (₹1,380 pomfret) wins; the removed ₹3,000 line doesn't count.
let checkout: any[] = [];
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
  const orders: any = {
    select: () => orders, eq: () => orders,
    maybeSingle: async () => ({ data: checkout[0] ?? null }),
    then: (r: any) => r({ data: checkout }),
  };
  return { createClient: () => ({ from: (t: string) => (t === "orders" ? orders : q) }) };
});

import { sendBuyerOrderPush } from "../../src/lib/server/buyer-push";

const line = (id: string, price: number, photo: string | null, status = "confirmed") =>
  ({ id, cart_id: "c1", status, total_price: price, listing: { seller_id: "ft", photo_url: photo } });

describe("buyer order push picture", () => {
  beforeEach(() => { sent.length = 0; process.env.VAPID_PRIVATE_KEY = "x"; process.env.PUBLIC_VAPID_KEY = "y"; });

  it("Order Confirmed carries the checkout's costliest listing photo", async () => {
    checkout = [line("o1", 300, "https://x/bombil.jpg"), line("o2", 1380, "https://x/pomfret.jpg"), line("o3", 3000, "https://x/removed.jpg", "cancelled")];
    const r = await sendBuyerOrderPush({ buyer_id: "buyer-1", status: "confirmed", species: "rawas", order_id: "o1", slot: { when: "Sat 24 Oct, 8–10 AM" } });
    expect(r.sent).toBe(true);
    expect(sent[0].title).toBe("Order Confirmed!");
    expect(sent[0].image).toBe("https://x/pomfret.jpg");
    expect(sent[0].url).toMatch(/\/track\/o1$/);
  });

  it("no photo on that listing → no picture (never a stock fish)", async () => {
    checkout = [line("o1", 300, "https://x/bombil.jpg"), line("o2", 1380, null)];
    await sendBuyerOrderPush({ buyer_id: "buyer-1", status: "confirmed", species: "rawas", order_id: "o1" });
    expect(sent[0].image).toBeUndefined();
  });

  it("other steps go out without a picture", async () => {
    checkout = [line("o1", 300, "https://x/bombil.jpg")];
    await sendBuyerOrderPush({ buyer_id: "buyer-1", status: "out_for_delivery", species: "rawas", order_id: "o1" });
    expect(sent[0].image).toBeUndefined();
  });
});
