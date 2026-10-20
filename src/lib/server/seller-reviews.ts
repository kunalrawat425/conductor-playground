import { createClient } from "@supabase/supabase-js";

/**
 * Buyer ratings shown on public seller and area pages.
 *
 * Only ratings left by buyers on their own delivered orders (the feedback API
 * only accepts completed / picked_up orders) and never ratings on test orders.
 * Orders sit behind RLS, so this reads with the service key on the server.
 * Buyer identity is never returned.
 */

const supabaseUrl = import.meta.env?.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env?.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

export type PublicReview = { sellerId: string; rating: number; text: string; species: string | null; date: string };
/** distribution = counts for 5★, 4★, 3★, 2★, 1★ over ALL ratings (not just the loaded rows). */
export type ReviewSummary = { count: number; average: number | null; distribution: number[]; reviews: PublicReview[] };

type FeedbackRow = { order_id: string; seller_id: string; rating: number; feedback: string | null; created_at: string };
type OrderRow = { id: string; is_test: boolean | null; species: string | null };

/** Pure part, exported for tests: drop test-order ratings, newest first, summarise. */
export function summariseReviews(feedback: FeedbackRow[], orders: OrderRow[], limit = 5): ReviewSummary {
  const realOrders = new Map(orders.filter((o) => o.is_test !== true).map((o) => [o.id, o]));
  const real = feedback
    .filter((f) => realOrders.has(f.order_id) && Number(f.rating) >= 1 && Number(f.rating) <= 5)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const count = real.length;
  const average = count ? Math.round((real.reduce((s, f) => s + Number(f.rating), 0) / count) * 10) / 10 : null;
  return {
    count,
    average,
    distribution: [5, 4, 3, 2, 1].map((star) => real.filter((f) => Number(f.rating) === star).length),
    reviews: real.slice(0, limit).map((f) => ({
      sellerId: f.seller_id,
      rating: Number(f.rating),
      text: String(f.feedback || "").trim().slice(0, 300),
      species: realOrders.get(f.order_id)?.species || null,
      date: f.created_at,
    })),
  };
}

/** "Based on 1 rating from buyers after delivery" (singular / plural). */
export function ratingsBasisLabel(count: number): string {
  return `Based on ${count} ${count === 1 ? "rating" : "ratings"} from buyers after delivery`;
}

export const EMPTY_REVIEWS: ReviewSummary = { count: 0, average: null, distribution: [0, 0, 0, 0, 0], reviews: [] };
const EMPTY = EMPTY_REVIEWS;

export const REVIEWS_PER_PAGE = 10;
export type ReviewFilters = { stars: number | null; fish: string | null; page: number };

/** ?stars=1..5 & ?fish=<species present in the reviews> & ?page=n. Anything else is ignored, never an error. */
export function parseReviewFilters(params: URLSearchParams, fishOptions: string[]): ReviewFilters {
  const stars = Number(params.get("stars"));
  const fish = (params.get("fish") || "").toLowerCase();
  const page = Math.floor(Number(params.get("page")));
  return {
    stars: Number.isInteger(stars) && stars >= 1 && stars <= 5 ? stars : null,
    fish: fishOptions.includes(fish) ? fish : null,
    page: page >= 1 ? page : 1,
  };
}

/** Shareable link for a filter state; defaults (all stars, all fish, page 1) are left out. */
export function reviewFilterHref(basePath: string, f: ReviewFilters): string {
  const q = new URLSearchParams();
  if (f.stars !== null) q.set("stars", String(f.stars));
  if (f.fish !== null) q.set("fish", f.fish);
  if (f.page > 1) q.set("page", String(f.page));
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}

/** Distinct species across the reviews, most reviewed first. */
export function reviewFishOptions(reviews: PublicReview[]): string[] {
  const counts = new Map<string, number>();
  for (const r of reviews) if (r.species) counts.set(r.species, (counts.get(r.species) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
}

/** Filter (already newest first) and cut one page; a page past the end clamps to the last page. */
export function pageReviews(reviews: PublicReview[], f: ReviewFilters, perPage = REVIEWS_PER_PAGE) {
  const matching = reviews.filter((r) => (f.stars === null || r.rating === f.stars) && (f.fish === null || r.species === f.fish));
  const pages = Math.max(1, Math.ceil(matching.length / perPage));
  const page = Math.min(f.page, pages);
  return { total: matching.length, page, pages, items: matching.slice((page - 1) * perPage, page * perPage) };
}

/** Never throws: a review fetch must not break a public page. */
export async function getSellerReviews(sellerIds: string[], limit = 5): Promise<ReviewSummary> {
  if (!sellerIds.length || !supabaseUrl || !supabaseServiceKey) return EMPTY;
  try {
    const sb = createClient(supabaseUrl, supabaseServiceKey);
    const { data: feedback, error } = await sb
      .from("order_feedback")
      .select("order_id, seller_id, rating, feedback, created_at")
      .in("seller_id", sellerIds);
    if (error || !feedback?.length) return EMPTY;
    const { data: orders, error: oErr } = await sb
      .from("orders")
      .select("id, is_test, species")
      .in("id", feedback.map((f) => f.order_id));
    if (oErr || !orders) return EMPTY;
    return summariseReviews(feedback as FeedbackRow[], orders as OrderRow[], limit);
  } catch (err: any) {
    console.warn("[seller-reviews] fetch failed", err?.message);
    return EMPTY;
  }
}

/**
 * Every real rating for one seller, newest first (the full reviews page filters and pages these).
 * ponytail: loads all rows, like the summary already does; move filter + range() into SQL past a few thousand ratings.
 */
export function getAllSellerReviews(sellerId: string): Promise<ReviewSummary> {
  return getSellerReviews([sellerId], Infinity);
}
