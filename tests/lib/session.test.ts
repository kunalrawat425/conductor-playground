import { describe, it, expect } from "vitest";
import { signSession, verifySession, requireSession } from "../../src/lib/server/session";

const S = "test-secret";

describe("signed sessions", () => {
  it("round-trips the id for the right role", () => {
    const t = signSession("buyer", "b1", S);
    expect(verifySession(t, "buyer", S)).toBe("b1");
  });

  it("rejects the other role, a forged signature, another secret, and expiry", () => {
    const t = signSession("buyer", "b1", S);
    expect(verifySession(t, "seller", S)).toBeNull();
    const [p] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ r: "seller", i: "s1", e: Date.now() + 1e9 })).toString("base64url");
    expect(verifySession(`${forged}.${t.split(".")[1]}`, "seller", S)).toBeNull();
    expect(verifySession(`${p}.AAAA`, "buyer", S)).toBeNull();
    expect(verifySession(t, "buyer", "other-secret")).toBeNull();
    expect(verifySession(t, "buyer", S, Date.now() + 400 * 86400_000)).toBeNull();
    expect(verifySession("garbage", "buyer", S)).toBeNull();
    expect(verifySession(null, "buyer", S)).toBeNull();
  });
});

describe("requireSession (uses INTERNAL_API_SECRET)", () => {
  const req = (h: Record<string, string>) => new Request("https://x/api", { headers: h });

  it("plain 400 (no re-login) when no id is sent at all", () => {
    const r = requireSession(req({}), "buyer", null)!;
    expect(r.status).toBe(400);
    expect(r.headers.get("x-rlf-login")).toBeNull();
  });

  it("asks for login when the token is missing", () => {
    const r = requireSession(req({}), "seller", "s1")!;
    expect(r.status).toBe(401);
    expect(r.headers.get("x-rlf-login")).toBe("seller");
  });
});
