/**
 * Pure copy for buyer order-status Web Push (tested independently of Supabase / web-push).
 */
export function buyerOrderPushNotification(
  status: string,
  species?: string | null,
  final_price?: number | null,
  /**
   * BUG-23: when Razorpay is live the buyer pays in a modal — there is no UPI
   * screenshot to upload, so the old "upload payment proof" copy actively
   * misdirected them. Defaults to the env flag; pass explicitly in tests.
   */
  razorpayEnabled: boolean = import.meta.env?.PUBLIC_ENABLE_RAZORPAY === "true"
): { title: string; body: string } {
  const messages: Record<string, { title: string; body: string }> = {
    placed: razorpayEnabled
      ? {
          title: "Order placed",
          body: species
            ? `Tap to pay securely and confirm your ${species} order.`
            : "Tap to pay securely and confirm your order.",
        }
      : {
          title: "Order placed",
          body: species
            ? `Open Relifish to upload UPI payment proof for your ${species} order.`
            : "Open Relifish to upload payment proof for your order.",
        },
    // Emitted only by /api/orders/upload-payment — the buyer definitely did
    // send a screenshot, so this copy must NOT vary with the Razorpay flag.
    proof_uploaded: {
      title: "Payment proof sent",
      body: species
        ? `We received your UPI screenshot for ${species}. The seller will verify shortly.`
        : "We received your payment screenshot. The seller will verify shortly.",
    },
    payment_verified: {
      title: "Payment verified",
      body: species
        ? `The seller verified your UPI payment for ${species}. Check your order for next steps.`
        : "Your payment was verified. Check your order for next steps.",
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
    cancelled: {
      title: "Order Cancelled",
      body: species
        ? `Your ${species} order was cancelled. Full refund processing.`
        : "Your order was cancelled. Full refund processing.",
    },
    paid: {
      title: "Payment received",
      body: species
        ? `Payment recorded for your ${species} order`
        : "Payment recorded for your order",
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
    pending_payment: razorpayEnabled
      ? {
          title: "Payment pending",
          body: species
            ? `Your ${species} order is waiting for payment. Tap to complete it.`
            : "Your order is waiting for payment. Tap to complete it.",
        }
      : {
          title: "Payment proof sent",
          body: species
            ? `We received your UPI screenshot for ${species}. The seller will verify shortly.`
            : "We received your payment screenshot. The seller will verify shortly.",
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
