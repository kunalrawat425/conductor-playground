import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/pages/api/wati/webhook";

const call = (q: string, body: unknown = { eventType: "sentMessageDELIVERED_v2" }) =>
  POST({ request: new Request(`https://x/api/wati/webhook${q}`, { method: "POST", body: JSON.stringify(body) }), url: new URL(`https://x/api/wati/webhook${q}`) } as any);

describe("Wati webhook", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("403 without the key or when no key is configured, 200 with it", async () => {
    vi.stubEnv("WATI_WEBHOOK_KEY", "");
    expect((await call("?key=")).status).toBe(403);
    vi.stubEnv("WATI_WEBHOOK_KEY", "s3cret");
    expect((await call("?key=nope")).status).toBe(403);
    expect((await call("?key=s3cret")).status).toBe(200);
  });
});
