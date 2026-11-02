import { describe, it, expect } from "vitest";
import { inboundLogRow } from "../../src/lib/server/whatsapp";

describe("inboundLogRow", () => {
  it("saves a text message with the sender and their WhatsApp name", () => {
    const r = inboundLogRow({ id: "wamid.1", from: "919870619974", timestamp: "1793600000", type: "text", text: { body: "Is surmai fresh today?" } },
      [{ wa_id: "919870619974", profile: { name: "Kunal" } }])!;
    expect(r.dedupe_key).toBe("in:wamid.1");
    expect(r.kind).toBe("inbound");
    expect(r.to_phone).toContain("9870619974");
    expect(r.payload).toEqual({ text: "Is surmai fresh today?", name: "Kunal", type: "text" });
  });
  it("labels media and skips rows without an id", () => {
    expect(inboundLogRow({ id: "wamid.2", from: "919000000000", type: "image", image: { caption: "this one" } })!.payload.text).toBe("[image: this one]");
    expect(inboundLogRow({ from: "919000000000" })).toBeNull();
  });
});
