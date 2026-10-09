import { describe, it, expect } from "vitest";
import { gaIdsFromCookies, gaPayload } from "../../src/lib/server/ga-mp";

describe("gaIdsFromCookies", () => {
  it("reads the client id and both session cookie formats", () => {
    expect(gaIdsFromCookies("a=1; _ga=GA1.1.123456789.1700000000; _ga_7MXZDZ1S4N=GS1.1.1728450000.3.1.1728450100.0.0.0"))
      .toEqual({ cid: "123456789.1700000000", sid: "1728450000" });
    expect(gaIdsFromCookies("_ga_7MXZDZ1S4N=GS2.1.s1728450000$o3$g1$t1728450100").sid).toBe("1728450000");
  });
  it("returns nothing for missing or malformed cookies", () => {
    expect(gaIdsFromCookies(null)).toEqual({});
    expect(gaIdsFromCookies("_ga=garbage; _ga_OTHER=GS1.1.1.1")).toEqual({});
  });
});

describe("gaPayload", () => {
  it("uses the browser ids when known and joins the session", () => {
    const b = gaPayload({ cid: "1.2", sid: "99" }, "order_X", "purchase", { transaction_id: "order_X", value: 1 });
    expect(b.client_id).toBe("1.2");
    expect(b.events[0]).toEqual({ name: "purchase", params: { transaction_id: "order_X", value: 1, session_id: "99", engagement_time_msec: 1 } });
  });
  it("falls back to a stable per-checkout client id", () => {
    expect(gaPayload({}, "order_X", "refund", {}).client_id).toBe("server.order_X");
  });
});
