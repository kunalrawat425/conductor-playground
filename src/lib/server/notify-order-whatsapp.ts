/**
 * WhatsApp order updates (rf2 utility templates), sent next to the existing push + email.
 * Buyers get: paid (rf2_paid, or rf2_paid_evening for a pre-order paid after 6 PM: the seller
 * confirms next morning), confirmed, out for delivery, delivered, and seller declined/cancelled
 * with the refund (rf2_cancelled). The unpaid-order nudge (rf2_unpaid) comes from the messaging
 * cron. Sellers get no WhatsApp (founder: email only).
 * Channel (founder, 30 Oct): WhatsApp when the buyer ticked the WhatsApp box, else SMS (MSG91,
 * orderSms); a WhatsApp that fails goes once by SMS. Idempotent per (event, order) via message_log.
 * Never throws: an order update must not fail because a message did.
 */
import { createClient } from "@supabase/supabase-js";
import { arrivingByLabel, slotLabel } from "../delivery-slots";
import { firstName, fishList, fishName } from "../messaging/templates";
import { costliestPhoto, istDate } from "../messaging/schedule";
import { dispatch, type SmsPart } from "./messaging";

export type OrderWaEvent = "unpaid" | "paid" | "confirmed" | "out_for_delivery" | "completed" | "cancelled";
const env = (k: string) => (import.meta as any).env?.[k] || process.env[k] || "";

export const ORDER_SELECT = "id, buyer_id, buyer_phone, species, is_test, is_preorder, delivery_slot_start, delivery_slot_end, listing:fish_listings(species, description, photo_url, seller_id, is_available, is_preorder_enabled, deleted_at, seller:sellers(name))";
const CHECKOUT_SELECT = `${ORDER_SELECT}, cart_id, total_price, status`;
const REMOVED = ["declined", "cancelled", "refunded"];
/** Order updates the buyer gets (founder 31 Oct): only "seller confirmed" and "out for delivery", on WhatsApp or SMS. */
export const BUYER_ORDER_EVENTS: OrderWaEvent[] = ["confirmed", "out_for_delivery"];

export type WaCancel = { reason?: string | null; refund?: string | null; removedFrom?: string | null };

/**
 * Order update picture (founder 30 Oct): the listing photo of the costliest live item of the
 * checkout (same cart_id, same seller; removed items don't count); that listing has no photo → null.
 * An item the seller removed (`cancel.removedFrom`) shows its own photo or null. Never stock.
 */
export function orderPhoto(ord: any, checkout: any[] = [ord], cancel?: WaCancel): string | null {
  if (cancel?.removedFrom) return ord.listing?.photo_url || null;
  return costliestPhoto(checkoutRows(ord, checkout).map((x) => ({ price: x.total_price, photo: x.listing?.photo_url })));
}
/** The live items of the order's checkout (same cart_id, same seller, not removed). */
const checkoutRows = (ord: any, checkout: any[]) => checkout.filter((x) => (ord.cart_id ? x.cart_id === ord.cart_id : x.id === ord.id)
  && x.listing?.seller_id === ord.listing?.seller_id && !REMOVED.includes(x.status));
/** Every fish of the order's checkout, costliest first: "Surmai, Bombil and 1 more" (unpaid reminders name the whole checkout). */
export function checkoutFish(ord: any, checkout: any[] = [ord], max?: number): string {
  const rows = [...checkoutRows(ord, checkout)].sort((a, b) => (Number(b.total_price) || 0) - (Number(a.total_price) || 0));
  return fishList((rows.length ? rows : [ord]).map((x) => fishName(x.listing?.description, x.listing?.species || x.species)), max);
}

/** Still on the seller's menu: not deleted, available today or open for pre-order. */
export const listingLive = (l: any) => !!l && !l.deleted_at && !!(l.is_available || l.is_preorder_enabled);

/**
 * The item rf2_order_again names (review B3): of the buyer's last completed checkout (`done`, oldest
 * first), the costliest item whose listing is still live; its own name and photo. None live → null.
 */
export function againOrder(done: any[]): any | null {
  const last = done.at(-1);
  if (!last) return null;
  return done.filter((o) => (o.cart_id || o.id) === (last.cart_id || last.id) && listingLive(o.listing))
    .sort((a, b) => (Number(b.total_price) || 0) - (Number(a.total_price) || 0))[0] ?? null;
}

/** The order (with cart_id, price, status) and every order of its checkout, for orderPhoto. */
export async function loadCheckout(sb: any, order_id: string): Promise<{ ord: any; checkout: any[] }> {
  const { data: ord } = await sb.from("orders").select(CHECKOUT_SELECT).eq("id", order_id).maybeSingle();
  if (!ord?.cart_id) return { ord, checkout: ord ? [ord] : [] };
  const { data: rows } = await sb.from("orders").select(CHECKOUT_SELECT).eq("cart_id", ord.cart_id);
  return { ord, checkout: rows?.length ? rows : [ord] };
}

/**
 * Template + variables (Meta's order) + header picture for one order update. Pure (tested).
 * `cancel` carries the reason and refund line the caller already worked out; `removedFrom`
 * (the cart's order id) makes rf2_cancelled about this one item while the rest goes ahead.
 * `checkout`: the checkout's orders, for the picture (orderPhoto).
 */
export function orderMessage(event: OrderWaEvent, ord: any, buyerName: string | null | undefined, nowMs = Date.now(), cancel?: WaCancel, checkout?: any[]): { template: string; body: string[]; image?: string | null } {
  const short = `#${String(ord.id).slice(0, 8).toUpperCase()}`;
  const name = firstName(buyerName);
  const fish = fishName(ord.listing?.description, ord.listing?.species || ord.species);
  const seller = ord.listing?.seller?.name || "The seller";
  const slot = ord.delivery_slot_start && ord.delivery_slot_end ? slotLabel(ord.delivery_slot_start, ord.delivery_slot_end) : "as agreed with the seller";
  const image = orderPhoto(ord, checkout, cancel);
  const istHour = new Date(nowMs + 5.5 * 3_600_000).getUTCHours();
  switch (event) {
    case "unpaid": return { template: "rf2_unpaid", body: [name, short, checkoutFish(ord, checkout), slot], image };
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

/** The SMS version of an order update (DLT templates in sms.ts; values cut to 30 chars there). Pure. */
export function orderSms(event: OrderWaEvent, ord: any, buyerName: string | null | undefined, cancel?: WaCancel, checkout?: any[]): SmsPart {
  const short = `#${String(ord.id).slice(0, 8).toUpperCase()}`;
  const fish = fishName(ord.listing?.description, ord.listing?.species || ord.species);
  const seller = ord.listing?.seller?.name || "The seller";
  const slot = ord.delivery_slot_start && ord.delivery_slot_end ? slotLabel(ord.delivery_slot_start, ord.delivery_slot_end) : "as agreed";
  switch (event) {
    case "unpaid": return { key: "UNPAID", vars: [firstName(buyerName), checkoutFish(ord, checkout, 30), slot] };
    case "paid": return { key: "PAID", vars: [short, seller, slot] };
    case "confirmed": return { key: "CONFIRMED", vars: [seller, short, slot] };
    case "out_for_delivery": return { key: "OUT", vars: [short, ord.delivery_slot_end ? arrivingByLabel(ord.delivery_slot_end) : "soon"] };
    case "completed": return { key: "DELIVERED", vars: [short, fish] };
    case "cancelled": {
      const amt = String(cancel?.refund || "").match(/₹\s?\d+(?:,\d+)*(?:\.\d+)?/)?.[0];
      const refund = amt ? `${amt.replace(/\s/g, "")} in 5-7 working days` : "not needed";
      const why = cancel?.reason?.replace(/\.+$/, "") || "seller couldn't take it";
      return cancel?.removedFrom
        ? { key: "CANCELLED", vars: [`#${String(cancel.removedFrom).slice(0, 8).toUpperCase()} (${fish})`, `${fish} not available`, refund] }
        : { key: "CANCELLED", vars: [short, why, refund] };
    }
  }
}

export async function notifyOrderWhatsApp(order_id: string, event: OrderWaEvent, cancel?: WaCancel) {
  if (!BUYER_ORDER_EVENTS.includes(event)) return;
  try {
    const sb = createClient(env("PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_KEY"));
    const { ord, checkout } = await loadCheckout(sb, order_id);
    if (!ord || ord.is_test) return;
    const { data: buyer } = ord.buyer_id
      ? await sb.from("buyers").select("id, phone, first_name, whatsapp_opt_in_at").eq("id", ord.buyer_id).maybeSingle()
      : { data: null as any };
    const m = orderMessage(event, ord, buyer?.first_name, Date.now(), cancel, checkout);
    // "Stop updates" stops promos only; updates about an order the buyer placed still come.
    await dispatch(sb, {
      dedupe_key: `${event}:${order_id}:buyer`, kind: `order_${event}`, slot_date: istDate(Date.now()), order_id, buyer_id: buyer?.id,
      phone: buyer?.phone || ord.buyer_phone, whatsappOk: !!buyer?.whatsapp_opt_in_at,
      template: m.template, body: m.body, headerImage: m.image, link_path: `/track/${order_id}`,
      sms: orderSms(event, ord, buyer?.first_name, cancel), smsOk: true, smsFallback: true,
    });
  } catch (err: any) {
    console.warn("[whatsapp] order update failed", { order_id, event, err: err?.message });
  }
}
