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
export type ReviewSummary = { count: number; average: number | null; reviews: PublicReview[] };

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

const EMPTY: ReviewSummary = { count: 0, average: null, reviews: [] };

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
