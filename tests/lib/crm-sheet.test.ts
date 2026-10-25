import { describe, expect, it } from "vitest";
import { crmRow, crmStage, type CrmBuyer } from "../../src/lib/crm-sheet";

const base: CrmBuyer = { phone: "9819292817", name: "", email: "", area: "Neelam Nagar", created_at: "2026-10-25T05:37:00Z",
  whatsapp_opt_in: false, whatsapp_opt_out: false, push: false, society: [], cart: [], cart_updated: null, orders: [] };
const order = (status: string, paid: boolean) => ({ id: "EEB0F7AC", species: "bombil", status, paid, amount: 313, created_at: "2026-10-25T06:02:00Z", seller: "Fishtokri", source: "" });

describe("crm sheet rows", () => {
  it("stages: phone only → cart → unpaid → paid → delivered; cancelled paid doesn't count", () => {
    expect(crmStage(base)).toBe(1);
    expect(crmStage({ ...base, cart: ["Bombil (Fishtokri)"] })).toBe(2);
    expect(crmStage({ ...base, orders: [order("pending_payment", false)] })).toBe(3);
    expect(crmStage({ ...base, orders: [order("refunded", true)] })).toBe(3);
    expect(crmStage({ ...base, orders: [order("confirmed", true)] })).toBe(4);
    expect(crmStage({ ...base, orders: [order("completed", true)] })).toBe(5);
  });
  it("formats the phone, IST times and the paid total like the sheet", () => {
    const r = crmRow({ ...base, orders: [order("completed", true)] });
    expect(r["Phone"]).toBe("+91 98192 92817");
    expect(r["Signed up"]).toBe("2026-10-25 11:07");
    expect(r["Paid total (Rs)"]).toBe(313);
    expect(r["Stage"]).toBe("5 Delivered - review");
  });
});
