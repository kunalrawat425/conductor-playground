import { describe, expect, it, vi } from "vitest";
import { EXPO_PUSH_URL, PUSH_SEND_OPTIONS, withExpo, type WebPushApi } from "../../src/lib/server/load-web-push";
import { isTerminalPushError } from "../../src/lib/server/push-error-classify";

const webPush = (): WebPushApi => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => "web") });
const reply = (status: number, json: unknown) => vi.fn(async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;
const expoSub = { endpoint: EXPO_PUSH_URL, expo: "ExponentPushToken[abc]" };
const payload = JSON.stringify({ title: "New order", body: "Surmai 1 kg", url: "https://www.relifish.com/dashboard/orders", tag: "t1" });

describe("withExpo", () => {
  it("leaves browser subscriptions to web-push", async () => {
    const wp = webPush(); const f = reply(200, {});
    const sub = { endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "a", auth: "b" } };
    expect(await withExpo(wp, f).sendNotification(sub, payload, PUSH_SEND_OPTIONS)).toBe("web");
    expect(f).not.toHaveBeenCalled();
  });

  it("sends an Expo subscription to Expo with title, body and the url as data", async () => {
    const f = reply(200, { data: { status: "ok", id: "r1" } });
    await withExpo(webPush(), f).sendNotification(expoSub, payload, PUSH_SEND_OPTIONS);
    const [url, init] = (f as any).mock.calls[0];
    const sent = JSON.parse(init.body);
    expect(url).toBe(EXPO_PUSH_URL);
    expect(sent).toMatchObject({ to: "ExponentPushToken[abc]", title: "New order", body: "Surmai 1 kg", priority: "high", ttl: 86400, data: { url: "https://www.relifish.com/dashboard/orders", tag: "t1" } });
  });

  it("maps DeviceNotRegistered to 410 so the dead token is cleared", async () => {
    const f = reply(200, { data: { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } } });
    const err = await withExpo(webPush(), f).sendNotification(expoSub, payload).catch((e) => e);
    expect(err.statusCode).toBe(410);
    expect(isTerminalPushError(err)).toBe(true);
  });

  it("keeps other Expo errors retryable", async () => {
    const err = await withExpo(webPush(), reply(503, { errors: [{ code: "INTERNAL", message: "down" }] })).sendNotification(expoSub, payload).catch((e) => e);
    expect(err.statusCode).toBe(503);
    expect(isTerminalPushError(err)).toBe(false);
  });
});
