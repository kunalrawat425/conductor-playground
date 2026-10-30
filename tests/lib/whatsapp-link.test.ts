import { describe, it, expect } from "vitest";
import { whatsappLink } from "../../src/lib/brand";

describe("whatsappLink (support chat)", () => {
  it("opens our number with no text", () => {
    expect(whatsappLink()).toBe("https://api.whatsapp.com/send?phone=919152207607");
  });
  it("prefills an encoded message", () => {
    const url = new URL(whatsappLink("Hi Relifish, I need help with order #AB12 & 🐟"));
    expect(url.searchParams.get("phone")).toBe("919152207607");
    expect(url.searchParams.get("text")).toBe("Hi Relifish, I need help with order #AB12 & 🐟");
  });
});
