/**
 * Buyer email subject + Gmail preview line (founder, 26 Oct): "Your Relifish order is …" first, like
 * bigbasket, so the brand and the status show before opening; the preview line says what happens next.
 * Seller emails keep their working subjects.
 */
import { refundLine } from "./order-payment-state";

export type BuyerEmailKind =
  | "placed" | "confirmed" | "out_for_delivery" | "delivered"
  | "seller_cancelled" | "buyer_cancelled" | "expired_unpaid" | "refunded";

export type BuyerEmailCtx = {
  fish: string;
  seller?: string | null;
  slot?: string | null;        // "today, 12–2 PM"
  by?: string | null;          // "2 PM" (out for delivery)
  amount?: number | null;      // refund amount, ₹
  refundSent?: boolean;        // Razorpay accepted the refund (refund_sent_at set)
  eveningPreorder?: boolean;   // paid after 6 PM for a pre-order: seller confirms next morning
  onTime?: boolean;            // delivered before the slot ended
};

const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function buyerEmailCopy(kind: BuyerEmailKind, c: BuyerEmailCtx): { subject: string; preview: string } {
  // Gentle next-step wording (founder, 1 Nov): no seller name, no dues tone; help is a real person.
  // ctx.seller is still accepted from callers but no longer shown.
  switch (kind) {
    case "placed":
      return { subject: "Your Relifish order is placed ✅", preview: c.eveningPreorder
        ? `Payment received for your ${c.fish}, thank you. Pre-orders are confirmed by 9:30 AM, and we'll let you know.`
        : `Payment received for your ${c.fish}, thank you. It's usually confirmed within 2 hours, and we'll let you know.` };
    case "confirmed":
      return { subject: "Your Relifish order is confirmed", preview: `${c.fish}, cleaned and cut your way, reaches you ${c.slot || "in your slot"}.` };
    case "out_for_delivery":
      return { subject: "Your Relifish order is on the way 🛵", preview: `${c.by ? `Should reach you by ${c.by}. ` : ""}Please keep your phone close for the delivery person.` };
    case "delivered":
      return { subject: c.onTime ? "Your Relifish order is delivered, on time!" : "Your Relifish order is delivered", preview: `Hope the ${c.fish} turns out just right. How was it?` };
    case "seller_cancelled":
      return { subject: "Your Relifish order couldn't go ahead", preview: `Sorry! ${c.amount ? `${refundLine(c.amount, !!c.refundSent)}.` : "No payment was taken."} We can help you pick another fish or slot.` };
    case "buyer_cancelled":
      return { subject: "Your Relifish order is cancelled", preview: c.amount ? "Refund details inside." : "No payment was taken." };
    case "expired_unpaid":
      return { subject: "Your Relifish order didn't go through", preview: "No payment was taken. Got stuck? WhatsApp or call us on 9152207607." };
    case "refunded":
      return { subject: "Your Relifish refund is on its way", preview: `${c.amount ? rs(c.amount) : "Your money"} refunded to your original payment method.` };
  }
}

/** Gmail/Apple Mail preview line: hidden text at the top of the body (the "preheader"). */
export function withPreview(html: string, preview: string): string {
  const esc = preview.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Trailing zero-width spaces stop the client from pulling body text into the preview.
  return `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${esc}${"&#8204;&nbsp;".repeat(40)}</div>${html}`;
}

/** Delivered within the booked slot (on time) when the slot end is known. */
export function deliveredOnTime(slotEnd: string | null | undefined, deliveredAtMs = Date.now()): boolean {
  const end = slotEnd ? Date.parse(slotEnd) : NaN;
  return Number.isFinite(end) && deliveredAtMs <= end;
}
