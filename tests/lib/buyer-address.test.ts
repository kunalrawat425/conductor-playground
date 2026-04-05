import { describe, it, expect, beforeEach } from "vitest";
import {
  formatSavedBuyerAddress,
  formatNewCheckoutAddress,
  formatAreaPart,
  composeBuyerAddressString,
  hasDeliveryUnitDetail,
} from "../../src/lib/buyer-address";

const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
  removeItem: (k: string) => {
    delete store[k];
  },
};

describe("buyer-address", () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
  });

  it("formatSavedBuyerAddress merges fields", () => {
    expect(
      formatSavedBuyerAddress({
        id: "1",
        buyer_id: "b",
        label: "Home",
        flat: "4B",
        building: "X",
        landmark: "Gate 2",
        location_name: "Versova",
        lat: 19.12,
        lng: 72.81,
        is_default: true,
      })
    ).toBe("4B, X, Gate 2 — Versova (19.12000, 72.81000)");
  });

  it("formatAreaPart handles name only", () => {
    expect(formatAreaPart("Bandra", null, null)).toBe("Bandra");
  });

  it("composeBuyerAddressString", () => {
    expect(composeBuyerAddressString("A", "B")).toBe("A — B");
    expect(composeBuyerAddressString(null, "B")).toBe("B");
  });

  it("hasDeliveryUnitDetail", () => {
    expect(hasDeliveryUnitDetail("", "")).toBe(false);
    expect(hasDeliveryUnitDetail("1", "")).toBe(true);
  });

  it("formatNewCheckoutAddress reads zepto_location", () => {
    store.zepto_location = JSON.stringify({ name: "Andheri", lat: 19.1, lng: 72.8 });
    expect(
      formatNewCheckoutAddress({ flat: "2", building: "Y", landmark: "" })
    ).toBe("2, Y — Andheri (19.10000, 72.80000)");
  });
});
