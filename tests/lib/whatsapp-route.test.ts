import { afterEach, describe, expect, it } from "vitest";
import { whatsappRoute } from "../../src/lib/server/messaging";

const promo = { whatsappOk: true, template: "rf2_promo_cart", sms: null };
const update = { whatsappOk: true, template: "rf2_confirmed", sms: { key: "CONFIRMED" as const, vars: [] } };
const seller = { whatsappOk: true, whatsappAlways: true, template: "rf2_seller_order", sms: { key: "SELLER_ORDER" as const, vars: [] } };

describe("whatsappRoute", () => {
  afterEach(() => { delete process.env.WHATSAPP_OFF; delete process.env.WHATSAPP_PROMOS_ONLY; });
  it("promos only: marketing by WhatsApp, utility with an SMS by SMS, seller order always WhatsApp", () => {
    process.env.WHATSAPP_PROMOS_ONLY = "true";
    expect(whatsappRoute(promo, false)).toBe(true);
    expect(whatsappRoute(update, true)).toBe(false);
    expect(whatsappRoute(update, false)).toBe(true); // no SMS version → WhatsApp rather than nothing
    expect(whatsappRoute(seller, true)).toBe(true);
  });
  it("WHATSAPP_OFF stops buyer WhatsApp but not the seller order; not opted in → never", () => {
    process.env.WHATSAPP_OFF = "true";
    expect(whatsappRoute(promo, false)).toBe(false);
    expect(whatsappRoute(seller, true)).toBe(true);
    expect(whatsappRoute({ ...promo, whatsappOk: false }, false)).toBe(false);
  });
});
