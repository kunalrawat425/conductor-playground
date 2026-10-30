/**
 * WhatsApp order updates (rf2 utility templates), sent next to the existing push + email.
 * Buyers get: paid (rf2_paid, or rf2_paid_evening for a pre-order paid after 6 PM: the seller
 * confirms next morning), confirmed, out for delivery, delivered, and seller declined/cancelled
 * with the refund (rf2_cancelled). The unpaid-order nudge (rf2_unpaid) comes from the messaging
 * cron. Sellers get no WhatsApp (founder: email only).
 * Buyers get them when they ticked the WhatsApp box. Idempotent per (event, order) via message_log.
 * Never throws: an order update must not fail because WhatsApp did.
 */
import { createClient } from "@supabase/supabase-js";
import { arrivingByLabel, slotLabel } from "../delivery-slots";
import { firstName, fishName, headerImage } from "../messaging/templates";
import { istDate } from "../messaging/schedule";
import { dispatch } from "./messaging";

export type OrderWaEvent = "unpaid" | "paid" | "confirmed" | "out_for_delivery" | "completed" | "cancelled";
const env = (k: string) => (import.meta as any).env?.[k] || process.env[k] || "";

export const ORDER_SELECT = "id, buyer_id, buyer_phone, species, is_test, is_preorder, delivery_slot_start, delivery_slot_end, listing:fish_listings(species, description, photo_url, seller_id, seller:sellers(name))";

/**
 * Template + variables (Meta's order) + header picture for one order update. Pure (tested).
 * `cancel` carries the reason and refund line the caller already worked out; `removedFrom`
 * (the cart's order id) makes rf2_cancelled about this one item while the rest goes ahead.
 */
export type WaCancel = { reason?: string | null; refund?: string | null; removedFrom?: string | null };
export function orderMessage(event: OrderWaEvent, ord: any, buyerName: string | null | undefined, nowMs = Date.now(), cancel?: WaCancel): { template: string; body: string[]; image?: string } {
  const short = `#${String(ord.id).slice(0, 8).toUpperCase()}`;
  const name = firstName(buyerName);
  const fish = fishName(ord.listing?.description, ord.listing?.species || ord.species);
  const seller = ord.listing?.seller?.name || "The seller";
  const slot = ord.delivery_slot_start && ord.delivery_slot_end ? slotLabel(ord.delivery_slot_start, ord.delivery_slot_end) : "as agreed with the seller";
  const image = headerImage(ord.listing?.photo_url, ord.listing?.species || ord.species);
  const istHour = new Date(nowMs + 5.5 * 3_600_000).getUTCHours();
  switch (event) {
    case "unpaid": return { template: "rf2_unpaid", body: [name, short, fish, slot], image };
    case "paid": return ord.is_preorder && istHour >= 18
      ? { template: "rf2_paid_evening", body: [short, name, slot, seller] }
      : { template: "rf2_paid", body: [short, name, seller] };
    case "confirmed": return { template: "rf2_confirmed", body: [seller, short, slot], image };
    case "out_for_delivery": return { template: "rf2_out", body: [short, ord.delivery_slot_end ? arrivingByLabel(ord.delivery_slot_end) : "soon"] };
    case "completed": return { template: "rf2_delivered", body: [fish, name, seller], image };
    case "cancelled": {
      const why = cancel?.reason?.replace(/\.+$/, "") || "the seller couldn't take it";
      const refund = cancel?.refund || "none needed, nothing was charged";
      // "Your order #CART (Saundale) couldn't go ahead: the seller removed Saundale (not available), the rest of your order goes ahead."
      if (cancel?.removedFrom) {
        return { template: "rf2_cancelled", body: [name, `#${String(cancel.removedFrom).slice(0, 8).toUpperCase()} (${fish})`, `the seller removed ${fish} (${why}), the rest of your order goes ahead`, refund] };
      }
      return { template: "rf2_cancelled", body: [name, short, why, refund] };
    }
  }
}

export async function notifyOrderWhatsApp(order_id: string, event: OrderWaEvent, cancel?: WaCancel) {
  try {
    const sb = createClient(env("PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_KEY"));
    const { data: o } = await sb.from("orders").select(ORDER_SELECT).eq("id", order_id).maybeSingle();
    if (!o || (o as any).is_test) return;
    const ord: any = o;
    const { data: buyer } = ord.buyer_id
      ? await sb.from("buyers").select("id, phone, first_name, whatsapp_opt_in_at").eq("id", ord.buyer_id).maybeSingle()
      : { data: null as any };
    const m = orderMessage(event, ord, buyer?.first_name, Date.now(), cancel);
    // "Stop updates" stops promos only; updates about an order the buyer placed still come.
    await dispatch(sb, {
      dedupe_key: `${event}:${order_id}:buyer`, kind: `order_${event}`, slot_date: istDate(Date.now()), order_id, buyer_id: buyer?.id,
      phone: buyer?.phone || ord.buyer_phone, whatsappOk: !!buyer?.whatsapp_opt_in_at,
      template: m.template, body: m.body, headerImage: m.image, link_path: `/track/${order_id}`,
    });
  } catch (err: any) {
    console.warn("[whatsapp] order update failed", { order_id, event, err: err?.message });
  }
}
