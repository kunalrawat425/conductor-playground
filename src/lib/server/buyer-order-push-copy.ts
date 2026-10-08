/**
 * Pure copy for buyer order-status Web Push (tested independently of Supabase / web-push).
 */
export function buyerOrderPushNotification(
  status: string,
  species?: string | null,
  final_price?: number | null,
  /** Cancellations: who did it and why, so the buyer sees it on the lock screen. */
  cancel?: { by?: string | null; reason?: string | null; refunded?: boolean } | null
): { title: string; body: string } {
  if (cancel && (status === "cancelled" || status === "declined")) {
    const fish = species ? `${species} ` : "";
    const reason = cancel.reason ? ` Reason: ${cancel.reason}` : "";
    const refund = cancel.refunded ? " Your payment is being refunded in full." : "";
    if (cancel.by === "seller") {
      return { title: "Order cancelled by the seller", body: `The seller cancelled your ${fish}order.${reason}${refund}`.trim() };
    }
    if (cancel.by === "buyer") {
      return { title: "You cancelled your order", body: `Your ${fish}order is cancelled.${reason}${refund}`.trim() };
    }
  }
  const messages: Record<string, { title: string; body: string }> = {
    // Razorpay is the only payment method: the buyer pays in a modal, there is
    // no screenshot to upload (BUG-23 told every buyer to upload one).
    placed: {
      title: "Order placed",
      body: species
        ? `Tap to pay securely and confirm your ${species} order.`
        : "Tap to pay securely and confirm your order.",
    },
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
      body: species ? `Sorry, your ${species} order was declined` : "Your order was declined",
    },
    // Emitted by the expire-pending-orders cron. Must make clear that nothing
    // was charged, otherwise a silent "cancelled" reads like money vanished.
    expired_unpaid: {
      title: "Order cancelled",
      body: species
        ? `Your ${species} order was cancelled — payment wasn't completed. You haven't been charged.`
        : "Your order was cancelled — payment wasn't completed. You haven't been charged.",
    },
    cancelled: {
      title: "Order Cancelled",
      body: species
        ? `Your ${species} order was cancelled. Full refund processing.`
        : "Your order was cancelled. Full refund processing.",
    },
    paid: {
      title: "Payment received",
      body: species
        ? `We got your payment for ${species}. Waiting for the seller to confirm your order.`
        : "We got your payment. Waiting for the seller to confirm your order.",
    },
    completed: {
      title: "Order completed",
      body: species ? `Your ${species} order is complete. Thanks!` : "Your order is complete. Thanks!",
    },
    refunded: {
      title: "Refund update",
      body: species
        ? `A refund was processed for your ${species} order`
        : "A refund was processed for your order",
    },
    pre_order: {
      title: "Pre-order update",
      body: species ? `Update on your ${species} pre-order` : "Update on your pre-order",
    },
    pending: {
      title: "Order received",
      body: species ? `Your ${species} order is pending seller action` : "Your order is pending seller action",
    },
    pending_payment: {
      title: "Payment pending",
      body: species
        ? `Your ${species} order is waiting for payment. Tap to complete it.`
        : "Your order is waiting for payment. Tap to complete it.",
    },
    payment_required: {
      title: "Payment needed",
      body: species ? `Complete payment for your ${species} order` : "Complete payment for your order",
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

  return (
    messages[status] || {
      title: "Order Update",
      body: `Your order status: ${status}`,
    }
  );
}
