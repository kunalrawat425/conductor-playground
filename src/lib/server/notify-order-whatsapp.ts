/**
 * WhatsApp order updates (utility templates), sent next to the existing push + email.
 * Buyers get only three: confirmed by the seller, out for delivery, delivered (founder, 24 Oct).
 * Payment received and cancellations stay on push + email. Sellers get the new paid order.
 * Buyers get them when they ticked the WhatsApp box; sellers when the founder recorded their
 * yes (sellers.whatsapp_opt_in_at). Idempotent per (event, order, party) via message_log.
 * Never throws: an order update must not fail because WhatsApp did.
 */
import { createClient } from "@supabase/supabase-js";
import { arrivingByLabel, slotLabel } from "../delivery-slots";
import { fishName, headerImage } from "../messaging/templates";
import { istDate } from "../messaging/schedule";
import { dispatch } from "./messaging";

export type OrderWaEvent = "paid" | "confirmed" | "out_for_delivery" | "completed";
const env = (k: string) => (import.meta as any).env?.[k] || process.env[k] || "";

export async function notifyOrderWhatsApp(order_id: string, event: OrderWaEvent) {
  try {
    const sb = createClient(env("PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_KEY"));
    const { data: o } = await sb.from("orders")
      .select("id, buyer_id, buyer_phone, species, is_test, delivery_slot_start, delivery_slot_end, pricing_label, listing:fish_listings(species, description, photo_url, seller_id)")
      .eq("id", order_id).maybeSingle();
    if (!o || (o as any).is_test) return;
    const ord: any = o;
    const short = `#${String(order_id).slice(0, 8).toUpperCase()}`;
    const fish = fishName(ord.listing?.description, ord.listing?.species || ord.species);
    const slot = ord.delivery_slot_start && ord.delivery_slot_end ? slotLabel(ord.delivery_slot_start, ord.delivery_slot_end) : "as agreed with the seller";
    const today = istDate(Date.now());
    const [{ data: buyer }, { data: seller }] = await Promise.all([
      ord.buyer_id ? sb.from("buyers").select("id, phone, whatsapp_opt_in_at, whatsapp_opt_out_at").eq("id", ord.buyer_id).maybeSingle() : Promise.resolve({ data: null }),
      ord.listing?.seller_id ? sb.from("sellers").select("id, phone, whatsapp_opt_in_at, whatsapp_opt_out_at").eq("id", ord.listing.seller_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    // "Stop updates" stops promos only; updates about an order the buyer placed still come.
    const buyerOk = !!buyer?.whatsapp_opt_in_at;
    const toBuyer = (template: string, body: string[], headerImage?: string) => dispatch(sb, {
      dedupe_key: `${event}:${order_id}:buyer`, kind: `order_${event}`, slot_date: today, order_id, buyer_id: buyer?.id,
      phone: buyer?.phone || ord.buyer_phone, whatsappOk: buyerOk, template, body, headerImage, link_path: `/track/${order_id}`,
    });
    switch (event) {
      case "paid": {
        if (seller) await dispatch(sb, {
          dedupe_key: `paid:${order_id}:seller`, kind: "seller_new_order", slot_date: today, order_id, seller_id: seller.id,
          phone: seller.phone, whatsappOk: !!seller.whatsapp_opt_in_at && !seller.whatsapp_opt_out_at,
          template: "rf_seller_new_order", body: [short, ord.pricing_label ? `${fish} ${ord.pricing_label.split(" · ")[0]}` : fish, slot],
          link_path: `/dashboard/orders?order=${order_id}`,
        });
        break;
      }
      case "confirmed": await toBuyer("rf_order_confirmed", [short, slot], headerImage(ord.listing?.photo_url, ord.listing?.species || ord.species)); break;
      case "out_for_delivery": await toBuyer("rf_order_out", [short, ord.delivery_slot_end ? arrivingByLabel(ord.delivery_slot_end) : "soon"]); break;
      case "completed": await toBuyer("rf_order_delivered", [short]); break;
    }
  } catch (err: any) {
    console.warn("[whatsapp] order update failed", { order_id, event, err: err?.message });
  }
}
