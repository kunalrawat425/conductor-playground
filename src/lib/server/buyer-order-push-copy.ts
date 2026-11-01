import { refundLine } from "../order-payment-state";

export type BuyerCancelInfo = {
  by?: string | null;
  reason?: string | null;
  refunded?: boolean;
  /** One item of a cart was cancelled and the rest goes ahead. */
  item?: { order_short: string; amount?: number | null; sent?: boolean } | null;
};

/**
 * Pure copy for buyer order-status Web Push (tested independently of Supabase / web-push).
 */
export function buyerOrderPushNotification(
  status: string,
  species?: string | null,
  final_price?: number | null,
  /** Cancellations: who did it and why, so the buyer sees it on the lock screen. */
  cancel?: BuyerCancelInfo | null,
  /** Delivery time: the slot ("Sat 25 Oct, 9–11 AM") when confirmed, "11 AM" when out for delivery. */
  slot?: { when: string; changed?: boolean } | null
): { title: string; body: string } {
  if (cancel && (status === "cancelled" || status === "declined")) {
    const fish = species ? `${species} ` : "";
    const reason = cancel.reason ? ` Reason: ${cancel.reason.replace(/[.!?]*$/, ".")}` : "";
    if (cancel.item) {
      const amt = cancel.item.amount ? ` — ${refundLine(cancel.item.amount, !!cancel.item.sent)}` : "";
      return { title: "Item removed from your order", body: `${species || "An item"} was removed from your order #${cancel.item.order_short}${amt}.${reason}` };
    }
    const refund = cancel.refunded ? " Your payment is being refunded in full." : "";
    if (cancel.by === "seller") {
      return { title: "Order cancelled", body: `Sorry, your ${fish}order couldn't go ahead.${reason}${refund} Want another fish or slot? WhatsApp us on 9152207607.`.trim() };
    }
    if (cancel.by === "buyer") {
      return { title: "You cancelled your order", body: `Your ${fish}order is cancelled.${reason}${refund}`.trim() };
    }
  }
  // Gentle next-step wording (founder, 1 Nov): never a dues notice or "pay now"; help is a real person.
  const almostDone = {
    title: "Your order is almost done",
    body: `Your ${species ? `${species} ` : ""}order is saved. The payment is the last step to confirm it for your slot. Stuck? WhatsApp us on 9152207607.`,
  };
  const messages: Record<string, { title: string; body: string }> = {
    // Razorpay is the only payment method: the buyer pays in a modal, there is
    // no screenshot to upload (BUG-23 told every buyer to upload one).
    placed: almostDone,
    confirmed: {
      title: "Order Confirmed!",
      body: species
        ? final_price
          ? `Your ${species} order confirmed at ₹${final_price}`
          : `Your ${species} order is confirmed`
        : "Your order has been confirmed",
    },
    picked_up: {
      title: "Ready for Pickup!",
      body: species ? `Your ${species} is ready for pickup` : "Your order is ready for pickup",
    },
    declined: {
      // Was "Order Update" — indistinguishable from the unknown-status fallback,
      // so a decline arrived on the lock screen looking like routine noise.
      title: "Order declined",
      body: `Sorry, your ${species ? `${species} ` : ""}order couldn't go ahead. Want another fish or slot? WhatsApp us on 9152207607.`,
    },
    // Emitted by the expire-pending-orders cron. Must make clear that nothing
    // was charged, otherwise a silent "cancelled" reads like money vanished.
    expired_unpaid: {
      title: "Your order didn't go through",
      body: `No payment was taken for your ${species ? `${species} ` : ""}order. Got stuck? WhatsApp us on 9152207607, we'll sort it out.`,
    },
    cancelled: {
      title: "Order cancelled",
      body: `Your ${species ? `${species} ` : ""}order was cancelled. Any payment is refunded in full. Questions? WhatsApp us on 9152207607.`,
    },
    paid: {
      title: "Payment received, thank you",
      body: `We got your payment for your ${species ? `${species} ` : ""}order. We'll let you know as soon as it's confirmed.`,
    },
    completed: {
      title: "Delivered!",
      body: `Hope you enjoy your ${species || "fish"}. Tap to tell us how it was.`,
    },
    refunded: {
      title: "Refund update",
      body: `A refund was processed for your ${species ? `${species} ` : ""}order. It reaches your account in 5–7 working days.`,
    },
    pre_order: {
      title: "Pre-order update",
      body: species ? `Update on your ${species} pre-order` : "Update on your pre-order",
    },
    pending: {
      title: "Order received",
      body: species ? `Your ${species} order is waiting for confirmation` : "Your order is waiting for confirmation",
    },
    pending_payment: almostDone,
    payment_required: {
      title: "Your order's final price is in",
      body: `The final price of your ${species ? `${species} ` : ""}order came out a little higher. Tap to see it. Questions? WhatsApp us on 9152207607.`,
    },
    ready_for_pickup: {
      title: "Ready for pickup",
      body: species ? `Your ${species} is ready for pickup` : "Your order is ready for pickup",
    },
    out_for_delivery: {
      title: "Out for delivery",
      body: species ? `Your ${species} order is on the way` : "Your order is out for delivery",
    },
    scheduled: {
      title: "Order Scheduled! 🗓️",
      body: species ? `Your ${species} order is scheduled. We'll notify you when it's time.` : "Your order is scheduled. We'll remind you!",
    },
  };

  if (slot?.when && (status === "confirmed" || status === "out_for_delivery")) {
    const m = messages[status];
    const changed = slot.changed ? " (new delivery time)" : "";
    return status === "confirmed"
      ? { title: m.title, body: `${m.body}. Delivery time: ${slot.when}${changed}` }
      : { title: m.title, body: `${m.body}, arriving by ${slot.when}${changed}` };
  }
  return (
    messages[status] || {
      title: "Order Update",
      // Never show a raw status code to the buyer.
      body: species ? `There's an update on your ${species} order. Tap to see it.` : "There's an update on your order. Tap to see it.",
    }
  );
}

/** Admin area promo pushes (/api/admin/push-area) with no picture of their own get this one. */
export const DEFAULT_PROMO_IMAGE = "/fish/pomfret.jpg";
