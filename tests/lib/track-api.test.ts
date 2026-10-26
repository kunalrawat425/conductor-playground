import { describe, expect, it, vi, beforeEach } from "vitest";

const inserted: any[] = [];
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: () => ({ insert: async (row: any) => { inserted.push(row); return { error: null }; } }) }) }));
const { POST } = await import("../../src/pages/api/track");
const call = (body: unknown) => POST({ request: new Request("http://x/api/track", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }) } as any);

describe("/api/track", () => {
  beforeEach(() => { inserted.length = 0; });
  it("stores a known funnel step and answers 204", async () => {
    const r = await call({ event: "login_shown", visitor_id: "v1", buyer_id: "not-a-uuid", path: "/s/fishtokri", internal: false });
    expect(r.status).toBe(204);
    expect(inserted[0]).toMatchObject({ event: "login_shown", visitor_id: "v1", buyer_id: null, path: "/s/fishtokri", internal: false });
  });
  it("drops unknown events, junk and oversized bodies without failing", async () => {
    expect((await call({ event: "drop_table" })).status).toBe(204);
    expect((await call("not json")).status).toBe(204);
    expect((await call({ event: "landing", meta: { x: "y".repeat(2000) } })).status).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].meta).toBeNull();
  });
});
