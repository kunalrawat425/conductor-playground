import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { loadWebPush } from "../../lib/server/load-web-push";
import { absoluteUrl } from "../../lib/server/site-origin";
import { normalizeVapidKeyForWebPush, trimVapidKey } from "../../lib/server/vapid-env";
import { normalizeSellerPushKind, sellerPushNotification } from "../../lib/server/seller-push-copy";

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
      .select("push_subscription, push_enabled, name")
      .eq("id", seller_id)
      .single();

    const subscription = normalizePushSubscription(seller?.push_subscription);
    if (!subscription?.endpoint) {
      return new Response(JSON.stringify({ skipped: true, reason: "no push subscription" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Heal flag when a subscription exists (mirrors buyer-push behavior).
    if (!seller?.push_enabled) {
      await supabase.from("sellers").update({ push_enabled: true }).eq("id", seller_id);
    }

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error("notify-seller: VAPID keys not configured");
      return new Response(JSON.stringify({ skipped: true, reason: "vapid not configured" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { title, body: pushBody } = sellerPushNotification(kind, {
      species,
      quantity,
      quantity_unit,
      scheduled_for,
      placement_kind,
      order_id_short,
      amount: typeof body.amount === "number" ? body.amount : null,
    });

    let dashboardUrl = absoluteUrl("/dashboard/orders");
    if (typeof order_id === "string" && /^[0-9a-f-]{36}$/i.test(order_id.trim())) {
      dashboardUrl = absoluteUrl(`/dashboard/orders?order=${encodeURIComponent(order_id.trim())}`);
    }

    try {
      const webPush = await loadWebPush();
      webPush.setVapidDetails(vapidContact, vapidPublicKey, vapidPrivateKey);
      await webPush.sendNotification(
        subscription,
        JSON.stringify({
          title,
          body: pushBody,
          url: dashboardUrl,
          tag: `seller-${kind}-${Date.now()}`,
        })
      );
    } catch (pushErr: any) {
      console.error("notify-seller push failed:", pushErr?.message || pushErr);
      // BUG-22 (seller side): a 404/410 endpoint is dead forever. Clear it so the
      // seller is re-prompted, instead of every future order push failing silently.
      const { isTerminalPushError, pushErrorStatus } = await import("../../lib/server/push-error-classify");
      if (isTerminalPushError(pushErr)) {
        await supabase
          .from("sellers")
          .update({ push_subscription: null, push_enabled: false })
          .eq("id", seller_id);
        console.warn(`[notify-seller] pruned dead subscription for seller ${seller_id} (HTTP ${pushErrorStatus(pushErr)})`);
        return new Response(JSON.stringify({ skipped: true, reason: "subscription expired — cleared", pruned: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ skipped: true, reason: pushErr?.message || "push failed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

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
