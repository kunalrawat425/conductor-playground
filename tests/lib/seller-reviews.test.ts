import { describe, it, expect } from "vitest";
import { summariseReviews } from "../../src/lib/server/seller-reviews";

const fb = (order_id: string, rating: number, created_at: string, feedback = "") => ({ order_id, seller_id: "s1", rating, feedback, created_at });

describe("summariseReviews", () => {
  it("drops ratings on test orders and averages the rest, newest first", () => {
    const out = summariseReviews(
      [fb("t1", 1, "2026-10-01"), fb("r1", 4, "2026-10-02", " Fresh pomfret "), fb("r2", 5, "2026-10-03")],
      [{ id: "t1", is_test: true, species: "surmai" }, { id: "r1", is_test: false, species: "pomfret" }, { id: "r2", is_test: null, species: "bombil" }]
    );
    expect(out.count).toBe(2);
    expect(out.average).toBe(4.5);
    expect(out.reviews.map((r) => r.species)).toEqual(["bombil", "pomfret"]);
    expect(out.reviews[1].text).toBe("Fresh pomfret");
  });

  it("returns no average when every rating is from a test order or unknown order", () => {
    const out = summariseReviews([fb("t1", 5, "2026-10-01"), fb("gone", 5, "2026-10-02")], [{ id: "t1", is_test: true, species: null }]);
    expect(out).toEqual({ count: 0, average: null, reviews: [] });
  });
});
