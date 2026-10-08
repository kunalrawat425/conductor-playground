import { describe, it, expect } from "vitest";
import { cancelledByText, cancelReasonText } from "../../src/lib/order-cancel";
import { buyerOrderPushNotification } from "../../src/lib/server/buyer-order-push-copy";
import { copyFor } from "../../src/lib/server/notify-order-parties";

describe("who cancelled + why", () => {
  it("names the actor from each viewer's side", () => {
    expect(cancelledByText("buyer", "buyer")).toBe("Cancelled by you");
    expect(cancelledByText("buyer", "seller")).toBe("Cancelled by the buyer");
    expect(cancelledByText("seller", "buyer")).toBe("Cancelled by the seller");
    expect(cancelledByText("seller", "seller")).toBe("Cancelled by you");
    expect(cancelledByText("system", "buyer", "auto_expired_payment")).toMatch(/automatically/);
  });

  it("hides system codes and empty reasons, keeps human ones", () => {
    expect(cancelReasonText("auto_expired_payment")).toBeNull();
    expect(cancelReasonText("e2e:run")).toBeNull();
    expect(cancelReasonText("  ")).toBeNull();
    expect(cancelReasonText("Fish sold out")).toBe("Fish sold out");
  });

  it("buyer push says who cancelled and why", () => {
    const n = buyerOrderPushNotification("cancelled", "Surmai", null, { by: "seller", reason: "Boat did not go out", refunded: true });
    expect(n.title).toBe("Order cancelled by the seller");
    expect(n.body).toContain("Boat did not go out");
    expect(n.body).toContain("refunded");
    const mine = buyerOrderPushNotification("cancelled", "Surmai", null, { by: "buyer", reason: null, refunded: false });
    expect(mine.title).toBe("You cancelled your order");
  });

  it("seller-cancel and buyer-cancel emails carry the reason", () => {
    expect(copyFor("cancelled_by_seller", "Surmai", "AB12", 500, "Sold out")!.buyerLine).toContain("Sold out");
    expect(copyFor("cancelled_by_buyer", "Surmai", "AB12", 500, "Changed plans")!.sellerLine).toContain("Changed plans");
  });
});
