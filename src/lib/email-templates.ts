/**
 * Branded email templates for Relifish transactional emails.
 * All templates produce inline-styled HTML compatible with major email clients.
 */

const BRAND_BLUE = "#0066cc";
const BRAND_DARK = "#0a0f1a";
const BRAND_LIGHT_BLUE = "#66b3ff";
const BRAND_ORANGE = "#ff6b35";

function shell(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:16px;">
  <!-- Header -->
  <div style="background:${BRAND_DARK};border-radius:16px 16px 0 0;padding:24px 28px;text-align:center;">
    <div style="font-size:28px;margin-bottom:4px;">🐟</div>
    <div style="font-size:22px;font-weight:800;color:${BRAND_LIGHT_BLUE};letter-spacing:-0.5px;">Relifish</div>
    <div style="font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:2px;text-transform:uppercase;margin-top:2px;">Mumbai's Fish Marketplace</div>
  </div>
  <!-- Body -->
  <div style="background:#ffffff;padding:28px;border-radius:0 0 16px 16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
    ${content}
  </div>
  <!-- Footer -->
  <div style="text-align:center;padding:20px 16px 8px;">
    <div style="font-size:12px;color:#999;">www.relifish.store</div>
    <div style="font-size:11px;color:#bbb;margin-top:4px;">© ${new Date().getFullYear()} Relifish. Mumbai, India.</div>
  </div>
</div>
</body>
</html>`;
}

function ctaButton(text: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;background:${BRAND_BLUE};color:#ffffff;padding:12px 32px;border-radius:10px;font-weight:700;text-decoration:none;font-size:14px;letter-spacing:0.3px;margin-top:8px;">${text}</a>`;
}

function statusBadge(label: string, color: string): string {
  return `<div style="display:inline-block;background:${color};color:#ffffff;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:700;letter-spacing:0.3px;">${label}</div>`;
}

function infoRow(label: string, value: string): string {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f2f5;">
    <span style="font-size:13px;color:#888;">${label}</span>
    <span style="font-size:14px;font-weight:600;color:#1a1a1a;">${value}</span>
  </div>`;
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

  const subtotal = totalAmount - deliveryFee;
  const orderIdShort = orderId ? orderId.substring(0, 8) : "";

  let schedHtml = "";
  if (scheduled_for) {
    const d = new Date(scheduled_for);
    schedHtml = infoRow(
      "🗓️ Scheduled",
      `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} at ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
    );
  }

  let notesHtml = "";
  if (cutStyle || buyerNotes) {
    const parts: string[] = [];
    if (cutStyle) parts.push(`✂️ ${cutStyle}`);
    if (buyerNotes) parts.push(`📝 ${buyerNotes}`);
    notesHtml = `<div style="background:#fff8e1;border-left:3px solid ${BRAND_ORANGE};border-radius:0 8px 8px 0;padding:10px 14px;margin-top:12px;font-size:13px;color:#555;">${parts.join("<br>")}</div>`;
  }

  return shell(`
    <div style="text-align:center;margin-bottom:20px;">
      ${statusBadge(statusLabel, statusColor(statusLabel))}
    </div>

    <!-- Order card -->
    <div style="background:#f8f9fa;border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:700;color:#1a1a1a;margin-bottom:12px;">🐟 ${species}</div>
      ${infoRow("Quantity", `${quantity} ${quantity_unit}`)}
      ${deliveryFee > 0 ? infoRow("Subtotal", `₹${subtotal}`) : ""}
      ${deliveryFee > 0 ? infoRow("Delivery Fee", `₹${deliveryFee}`) : ""}
      ${infoRow("Total", `₹${totalAmount}`)}
      ${schedHtml}
      ${orderIdShort ? `<div style="margin-top:10px;font-size:12px;color:#aaa;">Order #${orderIdShort}</div>` : ""}
    </div>
    ${notesHtml}

    <div style="text-align:center;margin-top:20px;">
      ${ctaButton("Track Order →", "https://www.relifish.store/v2/track")}
    </div>
  `);
}

export function orderEmailSeller(args: OrderEmailArgs & { buyerPhone?: string }): string {
  const {
    statusLabel, species, quantity, quantity_unit,
    totalAmount, deliveryFee = 0, orderId, scheduled_for,
    buyerNotes, cutStyle, buyerPhone,
  } = args;

  const subtotal = totalAmount - deliveryFee;
  const orderIdShort = orderId ? orderId.substring(0, 8) : "";

  let schedHtml = "";
  if (scheduled_for) {
    const d = new Date(scheduled_for);
    schedHtml = infoRow(
      "🗓️ Scheduled",
      `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} at ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
    );
  }

  let notesHtml = "";
  if (cutStyle || buyerNotes) {
    const parts: string[] = [];
    if (cutStyle) parts.push(`✂️ ${cutStyle}`);
    if (buyerNotes) parts.push(`📝 ${buyerNotes}`);
    notesHtml = `<div style="background:#fff8e1;border-left:3px solid ${BRAND_ORANGE};border-radius:0 8px 8px 0;padding:10px 14px;margin-top:12px;font-size:13px;color:#555;">${parts.join("<br>")}</div>`;
  }

  return shell(`
    <div style="text-align:center;margin-bottom:20px;">
      ${statusBadge(statusLabel, statusColor(statusLabel))}
    </div>

    <!-- Order card -->
    <div style="background:#f8f9fa;border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-size:18px;font-weight:700;color:#1a1a1a;margin-bottom:12px;">🐟 ${species}</div>
      ${"" /* buyerPhone stripped — never expose buyer phone to seller emails */}
      ${infoRow("Quantity", `${quantity} ${quantity_unit}`)}
      ${deliveryFee > 0 ? infoRow("Subtotal", `₹${subtotal}`) : ""}
      ${deliveryFee > 0 ? infoRow("Delivery Fee", `₹${deliveryFee}`) : ""}
      ${infoRow("Total", `₹${totalAmount}`)}
      ${schedHtml}
      ${orderIdShort ? `<div style="margin-top:10px;font-size:12px;color:#aaa;">Order #${orderIdShort}</div>` : ""}
    </div>
    ${notesHtml}

    <div style="text-align:center;margin-top:20px;">
      ${ctaButton("View Orders →", "https://www.relifish.store/v2/dashboard/orders")}
    </div>
  `);
}

// ── Verify Email ──────────────────────────────────────────────────────

export function verifyEmailTemplate(email: string, verifyUrl: string): string {
  return shell(`
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:40px;margin-bottom:8px;">✉️</div>
      <h1 style="font-size:20px;font-weight:800;color:#1a1a1a;margin:0 0 8px;">Verify your email</h1>
      <p style="font-size:14px;color:#666;line-height:1.5;margin:0;">Click the button below to verify<br><strong style="color:#1a1a1a;">${email}</strong></p>
    </div>

    <div style="text-align:center;margin:24px 0;">
      ${ctaButton("Verify Email ✓", verifyUrl)}
    </div>

    <div style="background:#f8f9fa;border-radius:10px;padding:14px 16px;margin-top:20px;">
      <p style="font-size:12px;color:#999;margin:0;line-height:1.5;">If you didn't request this verification, you can safely ignore this email. This link will work for the email address currently saved on your profile.</p>
    </div>
  `);
}
