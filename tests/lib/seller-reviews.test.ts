import { describe, it, expect } from "vitest";
import {
  summariseReviews, ratingsBasisLabel, parseReviewFilters, pageReviews, reviewFilterHref, reviewFishOptions, type PublicReview,
} from "../../src/lib/server/seller-reviews";

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
    expect(out).toEqual({ count: 0, average: null, distribution: [0, 0, 0, 0, 0], reviews: [] });
  });

  it("counts the 5→1 distribution over ALL real ratings, not just the loaded rows", () => {
    const ratings = [5, 5, 5, 4, 3, 1, 1, 0, 6];
    const out = summariseReviews(
      ratings.map((r, i) => fb(`o${i}`, r, `2026-10-${String(i + 1).padStart(2, "0")}`)),
      ratings.map((_, i) => ({ id: `o${i}`, is_test: i === 0, species: null })), // o0 is a test order
      2
    );
    expect(out.reviews).toHaveLength(2);
    expect(out.count).toBe(6); // 0 and 6 are out of range, o0 is a test
    expect(out.distribution).toEqual([2, 1, 1, 0, 2]);
    expect(out.distribution.reduce((a, b) => a + b, 0)).toBe(out.count);
  });
});

describe("ratingsBasisLabel", () => {
  it("uses singular for one rating and plural otherwise", () => {
    expect(ratingsBasisLabel(1)).toBe("Based on 1 rating from buyers after delivery");
    expect(ratingsBasisLabel(4)).toBe("Based on 4 ratings from buyers after delivery");
  });
});

describe("parseReviewFilters", () => {
  const p = (q: string) => parseReviewFilters(new URLSearchParams(q), ["pomfret", "surmai"]);
  it("reads valid stars, a known fish and the page", () => {
    expect(p("stars=4&fish=Pomfret&page=3")).toEqual({ stars: 4, fish: "pomfret", page: 3 });
  });
  it("ignores bad values instead of failing", () => {
    expect(p("stars=0&fish=shark&page=-2")).toEqual({ stars: null, fish: null, page: 1 });
    expect(p("stars=6&page=abc")).toEqual({ stars: null, fish: null, page: 1 });
    expect(p("stars=4.5&page=2.7")).toEqual({ stars: null, fish: null, page: 2 });
    expect(p("")).toEqual({ stars: null, fish: null, page: 1 });
  });
});

describe("pageReviews", () => {
  const rv = (i: number, rating: number, species: string | null): PublicReview => ({ sellerId: "s1", rating, text: `r${i}`, species, date: `2026-10-${i}` });
  const all = Array.from({ length: 23 }, (_, i) => rv(i, i % 2 ? 5 : 4, i % 3 ? "pomfret" : "surmai"));

  it("cuts 10 per page and reports the page count", () => {
    const out = pageReviews(all, { stars: null, fish: null, page: 3 });
    expect(out).toMatchObject({ total: 23, page: 3, pages: 3 });
    expect(out.items.map((r) => r.text)).toEqual(["r20", "r21", "r22"]);
  });
  it("clamps a page past the end to the last page", () => {
    expect(pageReviews(all, { stars: null, fish: null, page: 99 }).page).toBe(3);
  });
  it("filters by stars and fish together", () => {
    const out = pageReviews(all, { stars: 5, fish: "surmai", page: 1 });
    expect(out.items.every((r) => r.rating === 5 && r.species === "surmai")).toBe(true);
    expect(out.total).toBe(4); // i = 3, 9, 15, 21
  });
  it("has one empty page when nothing matches", () => {
    expect(pageReviews(all, { stars: 1, fish: null, page: 2 })).toEqual({ total: 0, page: 1, pages: 1, items: [] });
  });
});

describe("reviewFilterHref / reviewFishOptions", () => {
  it("leaves defaults out of the URL", () => {
    expect(reviewFilterHref("/s/x/reviews", { stars: null, fish: null, page: 1 })).toBe("/s/x/reviews");
    expect(reviewFilterHref("/s/x/reviews", { stars: 5, fish: "pomfret", page: 2 })).toBe("/s/x/reviews?stars=5&fish=pomfret&page=2");
  });
  it("round-trips through parseReviewFilters", () => {
    const f = { stars: 3, fish: "surmai", page: 4 };
    const url = new URL(reviewFilterHref("/r", f), "https://x.test");
    expect(parseReviewFilters(url.searchParams, ["surmai"])).toEqual(f);
  });
  it("lists species most reviewed first", () => {
    const r = (species: string | null) => ({ sellerId: "s", rating: 5, text: "", species, date: "" });
    expect(reviewFishOptions([r("surmai"), r("pomfret"), r("pomfret"), r(null)])).toEqual(["pomfret", "surmai"]);
  });
});
