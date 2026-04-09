/**
 * Pure copy for buyer order-status Web Push (tested independently of Supabase / web-push).
 */
export function buyerOrderPushNotification(
  status: string,
  species?: string | null,
  final_price?: number | null
): { title: string; body: string } {
  const messages: Record<string, { title: string; body: string }> = {
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
      title: "Order Update",
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
