import { describe, it, expect } from "vitest";
import { friendlyError, GENERIC_ERROR, NETWORK_ERROR } from "../../src/lib/friendly-error";

describe("friendlyError (no technical text on screen)", () => {
  it("keeps the server's plain sentences", () => {
    for (const m of [
      "This time is no longer available — pick another.",
      "The pre-order cutoff has passed — the seller is already getting your fish.",
      "Min order is ₹400",
      "OTP expired. Request a new one.",
    ]) expect(friendlyError(new Error(m))).toBe(m);
    expect(friendlyError({ error: "Pick a delivery time." })).toBe("Pick a delivery time.");
  });
  it("hides codes, HTTP, database and JS errors", () => {
    for (const m of [
      "slot_unavailable",
      "final_price required for set_final_price",
      "Cannot change from paid to ready_for_pickup",
      'duplicate key value violates unique constraint "orders_pkey"',
      "PGRST116: JSON object requested, multiple (or no) rows returned",
      'invalid input syntax for type uuid: "abc"',
      "Unexpected token < in JSON at position 0",
      "Cannot read properties of undefined (reading 'id')",
      "HTTP 500",
      "Request failed with status code 502",
      "MSG91 error (500)",
      "null",
      "x".repeat(200),
    ]) expect(friendlyError(new Error(m)), m).toBe(GENERIC_ERROR);
  });
  it("network failures get a connection hint", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toBe(NETWORK_ERROR);
    expect(friendlyError("Load failed")).toBe(NETWORK_ERROR);
  });
  it("empty or odd input uses the fallback", () => {
    expect(friendlyError(undefined, "Could not cancel.")).toBe("Could not cancel.");
    expect(friendlyError(new Error(""), "Try again.")).toBe("Try again.");
    expect(friendlyError(42)).toBe(GENERIC_ERROR);
  });
});
