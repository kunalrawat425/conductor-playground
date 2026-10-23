import { afterEach, describe, expect, it, vi } from "vitest";
import { MAIL_FROM, MAIL_FROM_FALLBACK, postToResend } from "../../src/lib/server/send-email";

const froms = () => (globalThis.fetch as any).mock.calls.map((c: any[]) => JSON.parse(c[1].body).from);
afterEach(() => vi.unstubAllGlobals());

describe("postToResend", () => {
  it("resends from the verified fallback when Resend says the domain isn't verified", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response('{"statusCode":403,"message":"The relifish.com domain is not verified."}', { status: 403 }))
      .mockResolvedValueOnce(new Response('{"id":"x"}', { status: 200 })));
    const res = await postToResend({ to: "a@b.co", subject: "s", html: "h" }, "re_test");
    expect(res.status).toBe(200);
    expect(froms()).toEqual([MAIL_FROM, MAIL_FROM_FALLBACK]);
  });

  it("sends once when the main domain works, and doesn't retry other errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await postToResend({ to: "a@b.co", subject: "s", html: "h" }, "re_test");
    expect(froms()).toEqual([MAIL_FROM]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"message":"API key is invalid"}', { status: 403 })));
    expect((await postToResend({ to: "a@b.co", subject: "s", html: "h" }, "bad")).status).toBe(403);
    expect(froms()).toEqual([MAIL_FROM]);
  });
});
