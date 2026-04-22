/**
 * Branded email templates for Relifish transactional emails.
 * All templates produce inline-styled HTML compatible with major email clients.
 */
import { fmtDateTimeFullIST } from "./format-ist";

const BRAND_BLUE = "#0066cc";
const BRAND_DARK = "#0a0f1a";
const BRAND_LIGHT_BLUE = "#66b3ff";
const BRAND_ORANGE = "#ff6b35";
const BRAND_SURFACE = "#f8fafc";

function shell(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f7;padding:20px 10px;">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(2,6,23,.08);">
        <tr>
          <td style="background:linear-gradient(135deg,${BRAND_DARK},#111a2a);padding:24px 28px;text-align:center;">
            <div style="font-size:30px;line-height:1;">🐟</div>
            <div style="font-size:24px;font-weight:800;color:${BRAND_LIGHT_BLUE};letter-spacing:-0.4px;margin-top:6px;">Relifish</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1.2px;text-transform:uppercase;margin-top:4px;">Mumbai's fish marketplace</div>
          </td>
        </tr>
        <tr>
          <td style="padding:26px 24px 20px;">
            ${content}
          </td>
        </tr>
      </table>
      <div style="font-size:12px;color:#8792a2;margin-top:12px;">www.relifish.store</div>
      <div style="font-size:11px;color:#a1acbb;margin-top:4px;">© ${new Date().getFullYear()} Relifish. Mumbai, India.</div>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function capitalizeFishName(name: string): string {
  const value = String(name || "").trim();
  if (!value) return "Fish";
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatQtyForEmail(quantity: number, quantityUnit: string): string {
  const unit = String(quantityUnit || "").toLowerCase();
  if (unit.includes("piece") || unit === "pc" || unit === "pcs") {
    return `${quantity} pack`;
  }
  return `${quantity} ${quantityUnit || "kg"}`;
}

function summaryRow(label: string, value: string, isTotal = false): string {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #e8edf5;font-size:13px;color:${isTotal ? "#0f172a" : "#667085"};font-weight:${isTotal ? "700" : "500"};">${label}</td>
    <td align="right" style="padding:10px 0;border-bottom:1px solid #e8edf5;font-size:14px;color:#0f172a;font-weight:${isTotal ? "800" : "600"};">${value}</td>
  </tr>`;
}

function orderSummaryTable(rows: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e8edf5;border-radius:12px;background:${BRAND_SURFACE};padding:14px 16px;">
    ${rows}
  </table>`;
}

function calloutBox(content: string, tone: "note" | "warning" = "note"): string {
  const styles =
    tone === "warning"
      ? "background:#fff7ed;border-left:3px solid #fb923c;color:#7c2d12;"
      : "background:#f5f8ff;border-left:3px solid #93c5fd;color:#1e3a8a;";
  return `<div style="${styles}border-radius:0 10px 10px 0;padding:12px 14px;margin-top:12px;font-size:13px;line-height:1.5;">${content}</div>`;
}

function noteLines(cutStyle?: string | null, buyerNotes?: string | null): string {
  const lines: string[] = [];
  if (cutStyle) lines.push(`Cut preference: <strong>${cutStyle}</strong>`);
  if (buyerNotes) lines.push(`Buyer notes: ${buyerNotes}`);
  return lines.join("<br>");
}

/** Shared masthead for all transactional emails (orders, account, alerts). */
function transactionIntro(eyebrow: string, title: string, subtitle: string): string {
  return `<div style="margin-bottom:14px;">
    <div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase;">${eyebrow}</div>
    <h1 style="font-size:22px;line-height:1.25;margin:6px 0 6px;color:#0f172a;">${title}</h1>
    <p style="font-size:14px;line-height:1.55;color:#475467;margin:0;">${subtitle}</p>
  </div>`;
}

function orderIntro(title: string, subtitle: string): string {
  return transactionIntro("Order update", title, subtitle);
}

function orderStatusHeader(statusLabel: string): string {
  return `<div style="text-align:center;margin-bottom:14px;">
      ${statusBadge(statusLabel, statusColor(statusLabel))}
    </div>`;
}

function footerSafetyText(): string {
  return `<div style="font-size:12px;color:#667085;line-height:1.5;margin-top:16px;">
    Need help? Reply to this email or contact support in the app.
  </div>
`;
}

function ctaButton(text: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;background:${BRAND_BLUE};color:#ffffff;padding:12px 28px;border-radius:10px;font-weight:700;text-decoration:none;font-size:14px;letter-spacing:0.2px;">${text}</a>`;
}

function statusBadge(label: string, color: string): string {
  return `<div style="display:inline-block;background:${color};color:#ffffff;padding:7px 16px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:0.35px;text-transform:uppercase;">${label}</div>`;
}

// ── Order Email (buyer + seller) ──────────────────────────────────────

export type OrderEmailArgs = {
  statusLabel: string;
  species: string;
  quantity: number;
  quantity_unit: string;
  totalAmount: number;
  deliveryFee?: number;
  orderId?: string;
  scheduled_for?: string | null;
  buyerNotes?: string | null;
  cutStyle?: string | null;
};

function statusColor(label: string): string {
  if (label.includes("Declined") || label.includes("Cancelled")) return "#dc3545";
  if (label.includes("Confirmed") || label.includes("Completed") || label.includes("Picked Up")) return "#28a745";
  if (label.includes("Ready") || label.includes("Delivery")) return BRAND_ORANGE;
  if (label.includes("Scheduled")) return "#1565c0";
  if (label.includes("Pre-order")) return "#7c4dff";
  return BRAND_BLUE;
}

export function orderEmailBuyer(args: OrderEmailArgs): string {
  const {
    statusLabel, species, quantity, quantity_unit,
    totalAmount, deliveryFee = 0, orderId, scheduled_for,
    buyerNotes, cutStyle,
  } = args;

  const fishName = capitalizeFishName(species);
  const subtotal = totalAmount - deliveryFee;
  const orderIdShort = orderId ? orderId.substring(0, 8) : "";
  const qtyText = formatQtyForEmail(quantity, quantity_unit);
  const rows = [
    summaryRow("Fish", fishName),
    summaryRow("Quantity", qtyText),
    deliveryFee > 0 ? summaryRow("Subtotal", `₹${subtotal.toLocaleString("en-IN")}`) : "",
    deliveryFee > 0 ? summaryRow("Delivery fee", `₹${deliveryFee.toLocaleString("en-IN")}`) : "",
    summaryRow("Total", `₹${totalAmount.toLocaleString("en-IN")}`, true),
    scheduled_for ? summaryRow("Scheduled for", fmtDateTimeFullIST(scheduled_for)) : "",
    orderIdShort ? summaryRow("Order ID", `#${orderIdShort.toUpperCase()}`) : "",
  ].join("");
  const notes = noteLines(cutStyle, buyerNotes);

  return shell(`
    ${orderStatusHeader(statusLabel)}
    ${orderIntro(
      `${fishName} order update`,
      "Your order status has changed. You can track every step in the app with live updates."
    )}
    ${orderSummaryTable(rows)}
    ${notes ? calloutBox(notes, "warning") : ""}
    <div style="text-align:center;margin-top:18px;">
      ${ctaButton("Track Order →", "https://www.relifish.store/v2/track")}
    </div>
    ${footerSafetyText()}
  `);
}

/** Seller alert when buyer uploads or replaces payment proof (matches branded shell). */
export function paymentProofReceivedEmailSeller(args: {
  species: string;
  orderIdShort: string;
  sellerName?: string | null;
}): string {
  const fishName = capitalizeFishName(args.species);
  const id = args.orderIdShort.toUpperCase();
  const greet = args.sellerName ? `Hi ${String(args.sellerName).trim()},` : "Hi,";
  return shell(`
    ${transactionIntro(
      "Action needed",
      "Payment screenshot received",
      `${greet} a buyer uploaded UPI payment proof for <strong>${fishName}</strong> (order <strong>#${id}</strong>). Open your dashboard to verify payment before confirming.`
    )}
    <div style="text-align:center;margin-top:18px;">
      ${ctaButton("Review in dashboard →", "https://www.relifish.store/v2/dashboard/orders")}
    </div>
    ${footerSafetyText()}
  `);
}

export function orderEmailSeller(args: OrderEmailArgs & { buyerPhone?: string }): string {
  const {
    statusLabel, species, quantity, quantity_unit,
    totalAmount, deliveryFee = 0, orderId, scheduled_for,
    buyerNotes, cutStyle, buyerPhone,
  } = args;

  const fishName = capitalizeFishName(species);
  const subtotal = totalAmount - deliveryFee;
  const orderIdShort = orderId ? orderId.substring(0, 8) : "";
  const qtyText = formatQtyForEmail(quantity, quantity_unit);
  const rows = [
    summaryRow("Fish", fishName),
    summaryRow("Quantity", qtyText),
    deliveryFee > 0 ? summaryRow("Subtotal", `₹${subtotal.toLocaleString("en-IN")}`) : "",
    deliveryFee > 0 ? summaryRow("Delivery fee", `₹${deliveryFee.toLocaleString("en-IN")}`) : "",
    summaryRow("Order value", `₹${totalAmount.toLocaleString("en-IN")}`, true),
    scheduled_for ? summaryRow("Scheduled for", fmtDateTimeFullIST(scheduled_for)) : "",
    orderIdShort ? summaryRow("Order ID", `#${orderIdShort.toUpperCase()}`) : "",
    buyerPhone ? summaryRow("Buyer", `***${String(buyerPhone).slice(-4)}`) : "",
  ].join("");
  const notes = noteLines(cutStyle, buyerNotes);

  return shell(`
    ${orderStatusHeader(statusLabel)}
    ${orderIntro(
      `${fishName} order needs attention`,
      "A customer order moved to a new state. Review the card below and take the next action from your dashboard."
    )}
    ${orderSummaryTable(rows)}
    ${notes ? calloutBox(notes, "warning") : ""}
    <div style="text-align:center;margin-top:18px;">
      ${ctaButton("View Orders →", "https://www.relifish.store/v2/dashboard/orders")}
    </div>
    ${footerSafetyText()}
  `);
}

// ── Verify Email ──────────────────────────────────────────────────────

export function verifyEmailTemplate(email: string, verifyUrl: string): string {
  return shell(`
    <div style="text-align:center;margin-bottom:8px;font-size:36px;line-height:1;">✉️</div>
    ${transactionIntro(
      "Account",
      "Verify your email",
      `Use the button below to confirm <strong style="color:#0f172a;">${email}</strong> on your Relifish profile. You will get order updates at this address when you opt in.`
    )}
    <div style="text-align:center;margin:22px 0;">
      ${ctaButton("Verify email", verifyUrl)}
    </div>
    ${calloutBox(
      "If you did not request this, you can ignore this message. The link only applies to the address shown above.",
      "note"
    )}
    ${footerSafetyText()}
  `);
}
