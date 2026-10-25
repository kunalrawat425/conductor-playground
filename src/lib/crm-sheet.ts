/**
 * Rows for the founder's buyer call sheet (Google Sheet, synced hourly by Apps Script).
 * Only the database columns; the founder's call notes live in the sheet and are never sent or overwritten.
 */
export type CrmOrder = { id: string; species: string | null; status: string; paid: boolean; amount: number; created_at: string; seller: string | null; source: string };
export type CrmBuyer = {
  phone: string; name: string; email: string; area: string; created_at: string;
  whatsapp_opt_in: boolean; whatsapp_opt_out: boolean; push: boolean;
  society: string[]; cart: string[]; cart_updated: string | null; orders: CrmOrder[];
};

export const CRM_STAGES = {
  1: { name: "1 Phone+OTP only", goal: "first order. Ask what fish they eat, which day suits, show them today's menu, help them add to cart on the call." },
  2: { name: "2 Added to cart", goal: "close the order. Ask what stopped them (price, timing, login, location, payment), fix it on the call, confirm a slot." },
  3: { name: "3 Order not paid", goal: "finish payment or understand the problem. Offer the order link in Chrome or a Razorpay link; note the exact issue." },
  4: { name: "4 Paid - delivery due", goal: "reassure and confirm slot. After delivery move them to stage 5 and call for review." },
  5: { name: "5 Delivered - review", goal: "review + repeat + referral. Ask fish quality, cut, delivery time, price; ask for a photo; next order; society/neighbours." },
} as const;

/** Furthest stage the buyer reached; cancelled/refunded orders don't count as paid. */
export function crmStage(b: Pick<CrmBuyer, "cart" | "orders">): 1 | 2 | 3 | 4 | 5 {
  const o = b.orders || [];
  if (o.some((x) => x.paid && x.status === "completed")) return 5;
  if (o.some((x) => x.paid && x.status !== "cancelled" && x.status !== "refunded")) return 4;
  if (o.length) return 3;
  if (b.cart.length) return 2;
  return 1;
}

const ist = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(0, 16).replace("T", " ") : "");

/** One row per buyer, keyed by the sheet's column headers (grey columns only). */
export function crmRow(b: CrmBuyer): Record<string, string | number> {
  const k = crmStage(b);
  const paid = b.orders.filter((x) => x.paid && x.status !== "cancelled" && x.status !== "refunded").reduce((s, x) => s + x.amount, 0);
  return {
    "Stage": CRM_STAGES[k].name,
    "Call goal": CRM_STAGES[k].goal,
    "Phone": `+91 ${b.phone.slice(0, 5)} ${b.phone.slice(5)}`,
    "Name": b.name,
    "Email": b.email,
    "Area set": b.area,
    "Society / building (saved address)": b.society.join(" | "),
    "Signed up": ist(b.created_at),
    "Cart (now)": b.cart.join(", "),
    "Cart updated": ist(b.cart_updated),
    "Orders": b.orders.map((x) => `#${x.id} ${x.species ?? ""} Rs${x.amount} ${x.status}${x.paid ? " PAID" : ""} ${ist(x.created_at).slice(5)} (${x.seller ?? "?"})`).join("; "),
    "Paid total (Rs)": paid || "",
    "Came from (order source)": [...new Set(b.orders.map((x) => x.source).filter(Boolean))].sort().join("; "),
    "WhatsApp opt-in": b.whatsapp_opt_in ? "Yes" : "No",
    "Push on": b.push ? "Yes" : "No",
  };
}
