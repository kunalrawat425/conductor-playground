import { describe, expect, it } from "vitest";
import { toSellerView } from "../../src/lib/seller-order-view";

const addr = { flat: "205", building: "Asteria Tower B", landmark: "Bethany Hospital", location_name: "Thane West 400610", lat: 19.2200836, lng: 72.9643834 };
const order = (status: string) => ({ id: "o", status, order_type: "delivery", buyer_phone: "9820138553", delivery_address: addr });

describe("seller view of the buyer's address", () => {
  it("before accepting: area + distance only, never flat or building", () => {
    const v: any = toSellerView(order("paid"), { lat: 19.1906444, lng: 72.9791824 });
    expect(v.delivery_address).toBeNull();
    expect(v.delivery_area).toEqual({ name: "Thane West 400610", km: expect.any(Number) });
    expect(v.delivery_area.km).toBeGreaterThan(3);
    expect(v.delivery_area.km).toBeLessThan(4);
    expect(JSON.stringify(v)).not.toMatch(/Asteria|205|Bethany/);
    expect(v.buyer_phone).toBe("8553");
  });
  it("after accepting: full address, no area line", () => {
    const v: any = toSellerView(order("confirmed"));
    expect(v.delivery_address).toEqual(addr);
    expect(v.delivery_area).toBeNull();
  });
  it("closed orders: neither", () => {
    const v: any = toSellerView(order("cancelled"));
    expect(v.delivery_address).toBeNull();
    expect(v.delivery_area).toBeNull();
  });
});
