import { describe, it, expect } from "vitest";
import { isTerminalPushError, pushErrorStatus } from "../../src/lib/server/push-error-classify";

/**
 * BUG-22 regression suite. Two symmetric failure modes to guard:
 *   - never pruning  → a buyer's dead subscription silently eats every push
 *   - over-pruning   → a transient 429/503 unsubscribes healthy buyers
 */
describe("push error classification — terminal", () => {
  it("treats 410 Gone as terminal", () => {
    expect(isTerminalPushError({ statusCode: 410 })).toBe(true);
  });

  it("treats 404 Not Found as terminal", () => {
    expect(isTerminalPushError({ statusCode: 404 })).toBe(true);
  });

  it("reads the code from statusCode, status, or response.status", () => {
    expect(isTerminalPushError({ statusCode: 410 })).toBe(true);
    expect(isTerminalPushError({ status: 410 })).toBe(true);
    expect(isTerminalPushError({ response: { status: 410 } })).toBe(true);
  });

  it("accepts a string status code (some transports stringify it)", () => {
    expect(isTerminalPushError({ statusCode: "410" })).toBe(true);
    expect(pushErrorStatus({ statusCode: "404" })).toBe(404);
  });
});

describe("push error classification — NOT terminal", () => {
  it("does not prune on rate limiting", () => {
    expect(isTerminalPushError({ statusCode: 429 })).toBe(false);
  });

  it("does not prune on push-service outages", () => {
    for (const code of [500, 502, 503, 504]) {
      expect(isTerminalPushError({ statusCode: code }), String(code)).toBe(false);
    }
  });

  it("does not prune on auth/VAPID misconfiguration", () => {
    // A bad VAPID key yields 401/403 for EVERY buyer — pruning here would wipe
    // the entire subscriber base on a single deploy mistake.
    expect(isTerminalPushError({ statusCode: 401 })).toBe(false);
    expect(isTerminalPushError({ statusCode: 403 })).toBe(false);
    expect(isTerminalPushError({ statusCode: 400 })).toBe(false);
  });

  it("does not prune on a bare network error with no status", () => {
    expect(isTerminalPushError(new Error("ECONNRESET"))).toBe(false);
    expect(pushErrorStatus(new Error("ECONNRESET"))).toBe(0);
  });

  it("does not prune on null / undefined / string errors", () => {
    expect(isTerminalPushError(null)).toBe(false);
    expect(isTerminalPushError(undefined)).toBe(false);
    expect(isTerminalPushError("410")).toBe(false);
    expect(isTerminalPushError({})).toBe(false);
  });

  it("does not prune on a non-numeric status", () => {
    expect(pushErrorStatus({ statusCode: "gone" })).toBe(0);
    expect(isTerminalPushError({ statusCode: "gone" })).toBe(false);
  });
});
