import { createHmac } from "node:crypto";
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const RAZORPAY_WEBHOOK_SECRET = import.meta.env.RAZORPAY_WEBHOOK_SECRET || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

async function sendResendEmail(to: string, subject: string, html: string) {
  if (!resendApiKey || !to) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Relifish <noreply@relifish.store>", to, subject, html }),
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (!RAZORPAY_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Webhook secret not configured" }), { status: 503 });
  }

  // Read raw body for signature verification — must not parse before verifying
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") || "";

  // Verify webhook signature
  const expectedSig = createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  if (expectedSig !== signature) {
    return new Response(JSON.stringify({ error: "Invalid webhook signature" }), { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const eventType: string = event.event || "";
  const refundEntity = event.payload?.refund?.entity;
  const paymentEntity = event.payload?.payment?.entity;

  // Only handle refund events — acknowledge others immediately
  if (!eventType.startsWith("refund.")) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
  }

  const razorpayPaymentId: string =
    refundEntity?.payment_id || paymentEntity?.id || "";
  const razorpayRefundId: string = refundEntity?.id || "";
  // Razorpay sends amount in paise — convert to rupees
  const refundAmtRupees: number = refundEntity?.amount
    ? Math.round(Number(refundEntity.amount) / 100)
    : 0;

  if (!razorpayPaymentId) {
    return new Response(JSON.stringify({ error: "No payment_id in webhook" }), { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Look up order by razorpay_payment_id
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select(`
      id, buyer_id, species, total_price, delivery_fee, refund_sent_at,
      listing:fish_listings(
        species,
        seller:sellers(id, name, email)
      )
    `)
    .eq("razorpay_payment_id", razorpayPaymentId)
    .maybeSingle();

  if (orderErr || !order) {
    // Payment ID not found — not our order, acknowledge silently
    return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
  }

  const orderId: string = (order as any).id;
  const species: string = (order as any).listing?.species || (order as any).species || "Fish";
  const seller = (order as any).listing?.seller;

  // ── refund.processed ──────────────────────────────────────────────────
  if (eventType === "refund.processed") {
    // Idempotency: if already marked sent, skip DB write but still return 200
    const alreadyRecorded = !!(order as any).refund_sent_at;

    if (!alreadyRecorded) {
      const refundUpdate: Record<string, any> = {
        refund_sent_at: new Date().toISOString(),
        refund_note: `Auto-processed by Razorpay (refund ID: ${razorpayRefundId})`,
      };
      if (refundAmtRupees > 0) refundUpdate.refund_amt = refundAmtRupees;

      const { error: updateErr } = await supabase
        .from("orders")
        .update(refundUpdate)
        .eq("id", orderId);

      if (updateErr) {
        return new Response(JSON.stringify({ error: "DB update failed" }), { status: 500 });
      }
    }

    // Fire emails — even if DB was already updated (idempotent re-send is fine)
    if (resendApiKey) {
      const { refundSentEmailBuyer, refundSentEmailSeller, capitalizeFishName } =
        await import("../../../lib/email-templates");
      const fishName = capitalizeFishName(species);

      // Buyer email
      if ((order as any).buyer_id) {
        const { data: buyer } = await supabase
          .from("buyers")
          .select("email")
          .eq("id", (order as any).buyer_id)
          .single();
        if (buyer?.email) {
          await sendResendEmail(
            buyer.email,
            `Refund processed — ${fishName}`,
            refundSentEmailBuyer({ species, orderId, refundNote: null })
          );
        }
      }

      // Seller email
      if (seller?.email) {
        await sendResendEmail(
          seller.email,
          `Refund confirmed by Razorpay — ${fishName}`,
          refundSentEmailSeller({ species, orderId, sellerName: seller.name })
        );
      }
    }

    return new Response(JSON.stringify({ ok: true, event: "refund.processed", order_id: orderId }), { status: 200 });
  }

  // ── refund.failed ─────────────────────────────────────────────────────
  if (eventType === "refund.failed") {
    // Update note so seller knows to retry manually
    await supabase
      .from("orders")
      .update({
        refund_note: `Razorpay refund FAILED (refund ID: ${razorpayRefundId}). Please retry manually.`,
      })
      .eq("id", orderId);

    // Alert seller by email
    if (seller?.email && resendApiKey) {
      const { capitalizeFishName } = await import("../../../lib/email-templates");
      const fishName = capitalizeFishName(species);
      const orderShort = orderId.slice(0, 8).toUpperCase();
      const html = `
        <div style="font-family:Inter,sans-serif;padding:24px;max-width:480px;margin:0 auto;">
          <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:12px;padding:20px;">
            <div style="font-weight:800;font-size:16px;color:#DC2626;margin-bottom:8px;">⚠️ Razorpay Refund Failed</div>
            <div style="font-size:13px;color:#1F2937;line-height:1.5;">
              The automated refund for <strong>${fishName}</strong> (Order #${orderShort})
              could not be processed by Razorpay.
            </div>
            <div style="margin-top:12px;font-size:12px;color:#6B7280;">
              Refund ID: ${razorpayRefundId}<br/>
              Please log into your Razorpay dashboard and retry the refund manually.
            </div>
          </div>
          <div style="text-align:center;margin-top:16px;">
            <a href="https://www.relifish.store/dashboard/orders"
               style="display:inline-block;background:#0066FF;color:#fff;font:700 13px Inter;
                      padding:10px 24px;border-radius:100px;text-decoration:none;">
              View Orders →
            </a>
          </div>
        </div>`;
      await sendResendEmail(seller.email, `Action needed: Razorpay refund failed — ${fishName}`, html);
    }

    return new Response(JSON.stringify({ ok: true, event: "refund.failed", order_id: orderId }), { status: 200 });
  }

  // Other refund.* events (refund.created, refund.speed_changed, etc.) — acknowledge
  return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
};
