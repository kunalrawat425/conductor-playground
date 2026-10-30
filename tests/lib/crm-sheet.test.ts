import { describe, expect, it } from "vitest";
import { crmRow, crmStage, isJunkWaitlist, lastActivity, waitlistRow, type CrmBuyer } from "../../src/lib/crm-sheet";

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
  it("last activity is the latest step with its IST time", () => {
    expect(lastActivity(base)).toBe("Signed up · 2026-10-25 11:07");
    expect(lastActivity({ ...base, cart: ["Bombil (Fishtokri)"], cart_updated: "2026-10-25T05:53:00Z" })).toBe("Added to cart · 2026-10-25 11:23");
    expect(lastActivity({ ...base, orders: [order("pending_payment", false)] })).toBe("Order created, not paid #EEB0F7AC · 2026-10-25 11:32");
    expect(lastActivity({ ...base, orders: [{ ...order("completed", true), updated_at: "2026-10-25T08:58:00Z" }] })).toBe("Delivered #EEB0F7AC · 2026-10-25 14:28");
  });
  it("waitlist rows: stage 0, wants + frequency in Last activity, junk filtered", () => {
    const r = waitlistRow({ phone: "9967743841", area: "Mulund West ", fish_wanted: "Surmai", frequency: "Occasionally", created_at: "2026-10-17T16:49:52Z" });
    expect(r["Stage"]).toBe("0 Waitlist");
    expect(r["Phone"]).toBe("+91 99677 43841");
    expect(r["Area set"]).toBe("Mulund West");
    expect(r["Last activity"]).toBe("Joined waitlist · wants Surmai (occasionally) · 2026-10-17 22:19");
    expect(isJunkWaitlist("9999999999", "Validation Test")).toBe(true);
    expect(isJunkWaitlist("7654345678", "addd")).toBe(true);
    expect(isJunkWaitlist("9004561446", "Tagore Nagar group no 5 Vikhroli east 400083")).toBe(false);
  });
});
