import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { loadWebPush, PUSH_SEND_OPTIONS } from "../../lib/server/load-web-push";
import { logPush } from "../../lib/server/push-log";
import { absoluteUrl } from "../../lib/server/site-origin";
import { normalizeVapidKeyForWebPush, trimVapidKey } from "../../lib/server/vapid-env";
import { normalizeSellerPushKind, orderSmsRecipients, sellerPushNotification } from "../../lib/server/seller-push-copy";
import { slotLabel } from "../../lib/delivery-slots";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

const vapidPublicKey = normalizeVapidKeyForWebPush(import.meta.env.PUBLIC_VAPID_KEY || "");
const vapidPrivateKey = normalizeVapidKeyForWebPush(import.meta.env.VAPID_PRIVATE_KEY || "");
const vapidContact = trimVapidKey(import.meta.env.VAPID_CONTACT || "") || "mailto:relifishstore@gmail.com";

function normalizePushSubscription(raw: unknown): { endpoint: string; keys?: { p256dh: string; auth: string } } | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as { endpoint: string; keys?: { p256dh: string; auth: string } };
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && raw !== null && "endpoint" in raw) {
    return raw as { endpoint: string; keys?: { p256dh: string; auth: string } };
  }
  return null;
}

/**
 * POST /api/notify-seller
 * Body: { seller_id, species, quantity, quantity_unit, buyer_phone, order_id?, kind? }
 * BUG-14: internal-only. Callers must send x-internal-api-secret header.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { assertInternalCaller } = await import("../../lib/server/internal-auth");
    const authCheck = assertInternalCaller(request);
    if (authCheck) return authCheck;

    const body = await request.json();
    const kind = normalizeSellerPushKind(body.kind);
    const {
      seller_id,
      species,
      quantity,
      quantity_unit,
      buyer_phone,
      scheduled_for,
      placement_kind,
      order_id_short,
      order_id,
    } = body;

    if (!seller_id) {
      return new Response(JSON.stringify({ error: "Missing seller_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: seller } = await supabase
      .from("sellers")
      .select("push_subscription, push_enabled, name, phone")
      .eq("id", seller_id)
      .single();

    // New / paid order: say when to deliver (the buyer's delivery time), read from the order so every caller gets it.
    let slot: string | null = null;
    if ((kind === "new_order" || kind === "payment_confirmed" || kind === "pay_on_delivery") && typeof order_id === "string" && /^[0-9a-f-]{36}$/i.test(order_id.trim())) {
      const { data: o } = await supabase.from("orders").select("delivery_slot_start, delivery_slot_end").eq("id", order_id.trim()).maybeSingle();
      if (o?.delivery_slot_start && o?.delivery_slot_end) slot = slotLabel(o.delivery_slot_start, o.delivery_slot_end);
    }

    const { title, body: pushBody } = sellerPushNotification(kind, {
      slot,
      species,
      quantity,
      quantity_unit,
      scheduled_for,
      placement_kind,
      order_id_short,
      amount: typeof body.amount === "number" ? body.amount : null,
      item_count: typeof body.item_count === "number" ? body.item_count : null,
      reason: typeof body.reason === "string" ? body.reason.slice(0, 200) : null,
      first_slot: typeof body.first_slot === "string" ? body.first_slot.slice(0, 40) : null,
    });

    let dashboardUrl = absoluteUrl("/dashboard/orders");
    if (typeof order_id === "string" && /^[0-9a-f-]{36}$/i.test(order_id.trim())) {
      dashboardUrl = absoluteUrl(`/dashboard/orders?order=${encodeURIComponent(order_id.trim())}`);
    }

    const log = (status: "success" | "failed" | "skipped", error_message: string | null = null) =>
      logPush(supabase, { seller_id, title, body: pushBody, url: dashboardUrl, status, error_message });

    // A new order to act on also goes to the seller's phone (pushes are often off on sellers' phones):
    // WhatsApp (rf2_seller_order, founder 7 Nov), even while buyer WhatsApp is paused; SMS only if the WhatsApp fails.
    // Once per order. ORDER_COPY_PHONES (comma list): the founder gets a copy of every one (founder, 6 Nov).
    if ((kind === "payment_confirmed" || kind === "pay_on_delivery") && typeof order_id === "string") {
      const { dispatch } = await import("../../lib/server/messaging");
      const { sellerOrderSms } = await import("../../lib/server/seller-push-copy");
      const { istDate } = await import("../../lib/messaging/schedule");
      const sms = sellerOrderSms(kind, order_id, typeof body.amount === "number" ? body.amount : null, slot);
      for (const [phone, key] of orderSmsRecipients(seller?.phone, import.meta.env.ORDER_COPY_PHONES || "", order_id)) {
        await dispatch(supabase, {
          dedupe_key: key, kind: "seller_order", slot_date: istDate(Date.now()), seller_id, order_id,
          phone, whatsappOk: true, whatsappAlways: true, template: "rf2_seller_order", body: sms.vars, link_path: "/dashboard/orders",
          sms, smsFallback: true,
        }).catch((err: any) => console.warn("[notify-seller] order message failed", { order_id, key, err: err?.message }));
      }
    }

    const subscription = normalizePushSubscription(seller?.push_subscription);
    if (!subscription?.endpoint) {
      await log("skipped", "no push subscription, seller has not enabled notifications");
      return new Response(JSON.stringify({ skipped: true, reason: "no push subscription" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Heal flag when a subscription exists (mirrors buyer-push behavior).
    if (!seller?.push_enabled) {
      await supabase.from("sellers").update({ push_enabled: true }).eq("id", seller_id);
    }

    // App subscriptions go through Firebase (FCM_SERVICE_ACCOUNT), not web-push: no VAPID needed.
    if ((!vapidPublicKey || !vapidPrivateKey) && (subscription as any)?.endpoint !== "fcm") {
      console.error("notify-seller: VAPID keys not configured");
      await log("skipped", "VAPID keys not configured");
      return new Response(JSON.stringify({ skipped: true, reason: "vapid not configured" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const webPush = await loadWebPush();
      if (vapidPublicKey && vapidPrivateKey) webPush.setVapidDetails(vapidContact, vapidPublicKey, vapidPrivateKey);
      await webPush.sendNotification(
        subscription,
        JSON.stringify({
          title,
          body: pushBody,
          url: dashboardUrl,
          tag: `seller-${kind}-${Date.now()}`,
        }),
        PUSH_SEND_OPTIONS
      );
    } catch (pushErr: any) {
      console.error("notify-seller push failed:", pushErr?.message || pushErr);
      await log("failed", String(pushErr?.statusCode || "") + " " + String(pushErr?.message || pushErr).slice(0, 300));
      // BUG-22 (seller side): a 404/410 endpoint is dead forever. Clear it so the
      // seller is re-prompted, instead of every future order push failing silently.
      const { isTerminalPushError, pushErrorStatus } = await import("../../lib/server/push-error-classify");
      if (isTerminalPushError(pushErr)) {
        await supabase
          .from("sellers")
          .update({ push_subscription: null, push_enabled: false })
          .eq("id", seller_id);
        console.warn(`[notify-seller] pruned dead subscription for seller ${seller_id} (HTTP ${pushErrorStatus(pushErr)})`);
        return new Response(JSON.stringify({ skipped: true, reason: "subscription expired, cleared", pruned: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ skipped: true, reason: pushErr?.message || "push failed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    await log("success");
    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Seller notify error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
