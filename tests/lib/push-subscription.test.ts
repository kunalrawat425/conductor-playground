import { describe, it, expect } from "vitest";
import { sameServerKey, urlBase64ToUint8Array } from "../../src/lib/push-subscription";
import { validSubscription } from "../../src/pages/api/push/resubscribe";

describe("push subscription reuse", () => {
  const key = urlBase64ToUint8Array("BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U");
  it("reuses a subscription made with the same VAPID key", () => {
    expect(sameServerKey(key.slice().buffer, key)).toBe(true);
  });
  it("recreates it when the key differs or is missing", () => {
    const other = key.slice(); other[5] ^= 1;
    expect(sameServerKey(other.buffer, key)).toBe(false);
    expect(sameServerKey(null, key)).toBe(false);
  });
});

describe("resubscribe input", () => {
  it("accepts a browser-shaped subscription only", () => {
    expect(validSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "a", auth: "b" } })).toBe(true);
    expect(validSubscription({ endpoint: "http://evil", keys: { p256dh: "a", auth: "b" } })).toBe(false);
    expect(validSubscription({ endpoint: "https://x" })).toBe(false);
    expect(validSubscription(null)).toBe(false);
  });
});
