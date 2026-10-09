import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { sendCustomBuyerPush } from "../../../lib/server/buyer-push";
import {
  abandonedCartBuyers,
  inSendingHours,
  REMIND_AFTER_MS,
  REMIND_WINDOW_MS,
  unpaidOrdersToRemind,
  windowNow,
} from "../../../lib/server/reminders";
import { getSpeciesDisplay } from "../../../lib/species";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const CRON_SECRET = import.meta.env.CRON_SECRET || "";

/**
 * Hourly: push reminders to buyers who
 *  - placed an order 1–2h ago and have not paid (no Razorpay capture, no verified payment,
 *    no UPI proof uploaded) → "Complete payment", links to /track/<id>
 *  - left items in their cart 1–2h ago and have not ordered since → "Your fish is still in your cart"
 * Fixed hourly windows (no double sends on late/re-runs), only 07:00–21:00 IST, no prices or
 * discounts (brand rules), and they do not touch the promo push throttle.
 * Scheduled by .github/workflows/remind-buyers.yml (Vercel Hobby crons are daily-only).
 * Auth: `Authorization: Bearer $CRON_SECRET`.
 */
async function run(request: Request) {
  if (!CRON_SECRET) return new Response(JSON.stringify({ error: "CRON_SECRET not configured" }), { status: 503 });
  if ((request.headers.get("authorization") || "") !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const now = windowNow(Date.now());
  if (!inSendingHours(Date.now())) return new Response(JSON.stringify({ ok: true, skipped: "quiet hours" }), { status: 200 });

  const sb = createClient(supabaseUrl, supabaseServiceKey);
  const from = new Date(now - REMIND_AFTER_MS - REMIND_WINDOW_MS).toISOString();
  const to = new Date(now - REMIND_AFTER_MS).toISOString();
  const push = (buyerId: string, title: string, body: string, path: string) =>
    sendCustomBuyerPush(buyerId, { title, body }, path, { markPromo: false }).catch((e) => ({ ok: false, error: e?.message }) as any);
  let unpaid = 0, carts = 0;

  const { data: pending, error: pErr } = await sb
    .from("orders")
    .select("id, buyer_id, species, created_at, razorpay_payment_id, payment_verified_at, payment_screenshot_urls")
    .eq("status", "pending_payment")
    .gt("created_at", from)
    .lte("created_at", to);
  if (pErr) console.warn("[cron/remind-buyers] orders query failed", pErr.message);
  for (const o of unpaidOrdersToRemind(pending ?? [], now)) {
    const fish = o.species ? getSpeciesDisplay(o.species) : "fish";
    const r = await push(o.buyer_id!, "Complete payment to confirm", `Your ${fish} order is waiting. Pay now so the seller can confirm it.`, `/track/${o.id}`);
    if (r?.sent) unpaid++;
  }

  // Carts: candidates first (activity in the window), then check they have not ordered since.
  const { data: cartRows, error: cErr } = await sb
    .from("buyer_cart")
    .select("buyer_id, created_at, updated_at")
    .gt("updated_at", from);
  if (cErr) console.warn("[cron/remind-buyers] cart query failed", cErr.message);
  const candidates = abandonedCartBuyers(cartRows ?? [], {}, now);
  if (candidates.length) {
    const { data: recent, error: oErr } = await sb.from("orders").select("buyer_id, created_at").in("buyer_id", candidates).gt("created_at", from);
    if (oErr) {
      console.warn("[cron/remind-buyers] order lookup failed; skipping cart reminders", oErr.message);
    } else {
      const ordersSince: Record<string, string> = {};
      for (const o of recent ?? []) {
        if (!ordersSince[o.buyer_id] || o.created_at > ordersSince[o.buyer_id]) ordersSince[o.buyer_id] = o.created_at;
      }
      for (const buyerId of abandonedCartBuyers(cartRows ?? [], ordersSince, now)) {
        const r = await push(buyerId, "Your fish is still in your cart", "Finish your order, or pre-order tonight for tomorrow's catch.", "/shop");
        if (r?.sent) carts++;
      }
    }
  }

  console.log(`[cron/remind-buyers] unpaid reminders: ${unpaid}, cart reminders: ${carts}`);
  return new Response(JSON.stringify({ ok: true, unpaid, carts }), { status: 200 });
}

export const GET: APIRoute = async ({ request }) => run(request);
export const POST: APIRoute = async ({ request }) => run(request);
