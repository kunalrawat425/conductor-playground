import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

/** Run public/sw.js's "push" handler with a payload and return what it passes to showNotification. */
async function showFor(payload: unknown) {
  const handlers: Record<string, (e: any) => void> = {};
  const shown: { title: string; opts: any }[] = [];
  const self: any = {
    addEventListener: (type: string, fn: any) => { handlers[type] = fn; },
    registration: { showNotification: async (title: string, opts: any) => { shown.push({ title, opts }); } },
    location: { origin: "https://www.relifish.com" },
    clients: {}, skipWaiting: () => {},
  };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, caches: {}, fetch: () => {}, URL, console, Date, Math, Promise });
  let wait: Promise<unknown> = Promise.resolve();
  handlers.push({ data: { json: () => payload, text: () => JSON.stringify(payload) }, waitUntil: (p: Promise<unknown>) => { wait = p; } });
  await wait;
  return shown[0];
}

describe("service worker push", () => {
  it("shows the big picture when the push has one (order confirmed, promos)", async () => {
    const n = await showFor({ title: "Order Confirmed!", body: "b", image: "https://www.relifish.com/fish/rawas.jpg", url: "/track/x" });
    expect(n.title).toBe("Order Confirmed!");
    expect(n.opts.image).toBe("https://www.relifish.com/fish/rawas.jpg");
    expect(n.opts.icon).toBe("/icon-192.png");
  });
  it("no picture when the push has none", async () => {
    const n = await showFor({ title: "Out for delivery", body: "b", url: "/track/x" });
    expect(n.opts.image).toBeUndefined();
  });
});
