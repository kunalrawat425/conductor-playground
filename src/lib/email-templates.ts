/**
 * Branded email templates for Relifish transactional emails.
 * All templates produce inline-styled HTML compatible with major email clients.
 */
import { fmtDateTimeFullIST, fmtDateTimeIST } from "./format-ist";

const BRAND_BLUE = "#0066cc";
const BRAND_DARK = "#0a0f1a";
const BRAND_LIGHT_BLUE = "#66b3ff";
const BRAND_ORANGE = "#ff6b35";
const BRAND_SURFACE = "#f8fafc";

const SUPPORT_EMAIL = "relifishstore@gmail.com";
const SUPPORT_PHONE = "+91 9152207607";

function shell(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f7;padding:20px 10px;">
  <tr>
    <td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(2,6,23,.08);">
        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,${BRAND_DARK},#111a2a);padding:24px 28px;text-align:center;">
            <img src="https://witoghpdfocywiosmrzv.supabase.co/storage/v1/object/public/meta/logo_horizontal.png" alt="Relifish" style="height:48px;width:auto;display:block;margin:0 auto;filter:brightness(0) invert(1);" />
            <div style="font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1.2px;text-transform:uppercase;margin-top:8px;">Fresh local seafood</div>
          </td>
        </tr>
        <!-- BODY -->
        <tr>
          <td style="padding:26px 24px 20px;">
            ${content}
          </td>
        </tr>
        <!-- FOOTER -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 24px;text-align:center;">
            <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:6px;">Need help?</div>
            <div style="font-size:12px;color:#475569;line-height:1.8;">
              📧 <a href="mailto:${SUPPORT_EMAIL}" style="color:#0066cc;text-decoration:none;">${SUPPORT_EMAIL}</a>
              &nbsp;&nbsp;·&nbsp;&nbsp;
              📞 <a href="tel:+919152207607" style="color:#0066cc;text-decoration:none;">${SUPPORT_PHONE}</a>
            </div>
            <div style="font-size:11px;color:#94a3b8;margin-top:10px;line-height:1.6;">
              <a href="https://www.relifish.store" style="color:#94a3b8;text-decoration:none;">www.relifish.store</a>
              &nbsp;·&nbsp; © ${new Date().getFullYear()} Relifish. All rights reserved.
            </div>
          </td>
        </tr>
      </table>
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
  `);
}

// ── Razorpay Payment Receipt (buyer) ─────────────────────────────────

export type ReceiptLineItem = {
  species: string;
  quantity: number;
  quantity_unit: string;
  total_price: number;
  cut_style?: string | null;
  buyer_notes?: string | null;
  order_id: string;
};

export type RazorpayReceiptArgs = {
  /** All orders in this checkout session (1 or more) */
  line_items: ReceiptLineItem[];
  delivery_fee: number;
  order_type: "pickup" | "delivery";
  seller_name: string;
  seller_location?: string | null;
  /** Buyer address — only relevant for delivery */
  buyer_addr?: string | null;
  /** Scheduled pickup/delivery time if set */
  scheduled_for?: string | null;
  /** Razorpay payment ID e.g. pay_xxxxx */
  razorpay_payment_id: string;
  /** ISO timestamp when payment was confirmed */
  paid_at: string;
  /** Primary order ID (first in session) used for track link */
  primary_order_id: string;
};

export function razorpayReceiptEmail(args: RazorpayReceiptArgs): string {
  const {
    line_items,
    delivery_fee,
    order_type,
    seller_name,
    seller_location,
    buyer_addr,
    scheduled_for,
    razorpay_payment_id,
    paid_at,
    primary_order_id,
  } = args;

  // Validate and sanitise all inputs
  const safeItems = (Array.isArray(line_items) ? line_items : []).filter(
    (i) => i && i.order_id && i.species
  );
  if (safeItems.length === 0) return ""; // nothing to send

  const safeSeller = String(seller_name || "Your seller").trim() || "Your seller";
  const safeLocation = seller_location ? String(seller_location).trim() : null;
  const safeDeliveryFee = Math.max(0, Number(delivery_fee) || 0);
  const isDelivery = order_type === "delivery";
  const safePaymentId = String(razorpay_payment_id || "").trim();
  const safePaidAt = paid_at ? fmtDateTimeIST(paid_at) : fmtDateTimeIST(new Date());
  const safeOrderId = String(primary_order_id || "").slice(0, 8).toUpperCase();
  const safeScheduled = scheduled_for ? fmtDateTimeFullIST(scheduled_for) : null;
  const safeBuyerAddr = buyer_addr ? String(buyer_addr).trim() : null;

  // Subtotal = sum of all line item prices
  const subtotal = safeItems.reduce((s, i) => s + Math.max(0, Number(i.total_price) || 0), 0);
  const grandTotal = subtotal + safeDeliveryFee;

  // Line item rows
  const itemRows = safeItems.map((item) => {
    const name = capitalizeFishName(item.species);
    const qty = formatQtyForEmail(Number(item.quantity) || 0, item.quantity_unit || "kg");
    const price = Math.max(0, Number(item.total_price) || 0);
    const extras: string[] = [];
    if (item.cut_style) extras.push(`✂️ ${String(item.cut_style).trim()}`);
    if (item.buyer_notes) extras.push(`📝 ${String(item.buyer_notes).slice(0, 120)}`);
    return `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #e8edf5;vertical-align:top;">
        <div style="font-size:14px;font-weight:700;color:#0f172a;text-transform:capitalize;">${name}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">${qty}</div>
        ${extras.length ? `<div style="font-size:11px;color:#64748b;margin-top:3px;line-height:1.4;">${extras.join(" &nbsp;·&nbsp; ")}</div>` : ""}
      </td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #e8edf5;font-size:14px;font-weight:700;color:#0f172a;vertical-align:top;white-space:nowrap;">
        ₹${price.toLocaleString("en-IN")}
      </td>
    </tr>`;
  }).join("");

  // Totals rows
  const totalRows = [
    safeDeliveryFee > 0
      ? `<tr>
          <td style="padding:6px 0;font-size:13px;color:#64748b;">Subtotal</td>
          <td align="right" style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:600;">₹${subtotal.toLocaleString("en-IN")}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#64748b;">Delivery fee</td>
          <td align="right" style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:600;">₹${safeDeliveryFee.toLocaleString("en-IN")}</td>
        </tr>`
      : "",
    `<tr>
      <td style="padding:10px 0 0;font-size:15px;font-weight:800;color:#0f172a;border-top:2px solid #0066cc;">Total Paid</td>
      <td align="right" style="padding:10px 0 0;font-size:16px;font-weight:800;color:#0066cc;border-top:2px solid #0066cc;">₹${grandTotal.toLocaleString("en-IN")}</td>
    </tr>`,
  ].join("");

  // Fulfilment block — delivery vs pickup
  const fulfilmentBlock = isDelivery
    ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px 16px;margin-top:16px;">
        <div style="font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">🚲 Delivery Details</div>
        ${safeBuyerAddr ? `<div style="font-size:13px;color:#1e40af;font-weight:600;margin-bottom:2px;">📍 ${safeBuyerAddr}</div>` : ""}
        ${safeScheduled
          ? `<div style="font-size:13px;color:#1e40af;">🕐 Scheduled: ${safeScheduled}</div>`
          : `<div style="font-size:13px;color:#1e40af;">Your order will be delivered after the seller confirms.</div>`}
      </div>`
    : `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin-top:16px;">
        <div style="font-size:12px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">🧊 Pickup Details</div>
        <div style="font-size:13px;color:#166534;font-weight:600;margin-bottom:2px;">📍 ${safeSeller}${safeLocation ? ` — ${safeLocation}` : ""}</div>
        ${safeScheduled
          ? `<div style="font-size:13px;color:#166534;">🕐 Pickup slot: ${safeScheduled}</div>`
          : `<div style="font-size:13px;color:#166534;">Seller will notify you when your order is ready for pickup.</div>`}
      </div>`;

  // Order meta strip
  const orderMeta = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"
    style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;margin-bottom:16px;">
    <tr>
      <td style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;padding-bottom:3px;">Order ID</td>
      <td style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;padding-bottom:3px;text-align:center;">Date &amp; Time</td>
      <td style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;padding-bottom:3px;text-align:right;">Type</td>
    </tr>
    <tr>
      <td style="font-size:13px;font-weight:700;color:#0f172a;">#${safeOrderId}</td>
      <td style="font-size:12px;font-weight:600;color:#0f172a;text-align:center;">${safePaidAt}</td>
      <td style="font-size:13px;font-weight:700;color:#0f172a;text-align:right;">${isDelivery ? "🚲 Delivery" : "🧊 Pickup"}</td>
    </tr>
  </table>`;

  // Seller block — inline-block spans for email client compatibility (no flexbox)
  const sellerBlock = `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:16px;">
    <span style="font-size:22px;line-height:1;vertical-align:middle;">🎣</span>
    <span style="font-size:13px;font-weight:700;color:#0f172a;vertical-align:middle;margin-left:10px;">${safeSeller}</span>
    ${safeLocation ? `<div style="font-size:11px;color:#64748b;margin-top:4px;padding-left:32px;">📍 ${safeLocation}</div>` : ""}
  </div>`;

  // Payment confirmation block — inline-block spans for email client compatibility
  const paymentBlock = `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;margin-top:16px;">
    <span style="font-size:22px;line-height:1;vertical-align:middle;">✅</span>
    <span style="font-size:12px;font-weight:700;color:#15803d;vertical-align:middle;margin-left:10px;">Paid via Razorpay</span>
    ${safePaymentId ? `<div style="font-size:10px;color:#64748b;font-family:monospace;margin-top:4px;padding-left:32px;">${safePaymentId}</div>` : ""}
  </div>`;

  return shell(`
    <div style="text-align:center;margin-bottom:16px;">
      <div style="display:inline-block;background:#059669;color:#fff;padding:7px 18px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;">✓ Payment Confirmed</div>
    </div>
    <div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">Payment Receipt</div>
    <h1 style="font-size:20px;line-height:1.25;margin:0 0 4px;color:#0f172a;">Your order is confirmed</h1>
    <p style="font-size:14px;line-height:1.55;color:#475467;margin:0 0 18px;">Here's your receipt. Track your order in the app for live updates.</p>

    ${orderMeta}
    ${sellerBlock}

    <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Items Ordered</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
      style="border:1px solid #e8edf5;border-radius:12px;background:#f8fafc;padding:0 16px;">
      ${itemRows}
      <tr><td colspan="2" style="padding:10px 0 0;">${totalRows}</td></tr>
    </table>

    ${paymentBlock}
    ${fulfilmentBlock}

    <div style="text-align:center;margin-top:20px;">
      ${ctaButton("Track Order →", `https://www.relifish.store/track/${primary_order_id}`)}
    </div>

    <div style="font-size:11px;color:#94a3b8;text-align:center;margin-top:18px;line-height:1.8;">
      This is a payment receipt, not a tax invoice.
    </div>
  `);
}
