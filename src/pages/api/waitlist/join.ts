import type { APIRoute } from "astro";
import { MAIL_FROM, MAIL_DOMAIN } from "../../../lib/server/send-email";
import { requireBuyer } from "../../../lib/server/session";
import { createClient } from "@supabase/supabase-js";
import { normalizeIndianMobile } from "../../../lib/indian-phone";
import { clientKey, overLimit } from "../../../lib/server/rate-limit";
import { escapeHtml } from "../../../lib/html";
import { LOGO_URL } from "../../../lib/brand";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

export const POST: APIRoute = async ({ request }) => {
  try {
    // BUG-18: public unauthenticated endpoint — cap signups per IP so the
    // waitlist table can't be flooded with junk rows. 5 per 10 min is far
    // above any legitimate human rate.
    const limited = overLimit(`waitlist:${clientKey(request)}`, 5, 10 * 60 * 1000)
      ? new Response(JSON.stringify({ error: "Too many requests. Please try again shortly." }), { status: 429 })
      : null;
    if (limited) return limited;

    const { buyer_id, phone, area, fish_wanted, frequency, preference, budget, notes, email } = await request.json();

    if (!phone || !area) {
      return new Response(
        JSON.stringify({ error: "Phone and area are required" }),
        { status: 400 }
      );
    }

    const phoneNorm = normalizeIndianMobile(String(phone));
    if (!phoneNorm.ok) {
      return new Response(JSON.stringify({ error: phoneNorm.message }), { status: 400 });
    }
    const phoneE164 = `+91${phoneNorm.digits10}`;

    const sb = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await sb
      .from("buyer_waitlist")
      .upsert(
        {
          buyer_id: buyer_id && !requireBuyer(request, buyer_id) ? buyer_id : null,
          phone: phoneE164,
          area,
          fish_wanted: fish_wanted || null,
          frequency: frequency || null,
          preference: preference || null,
          budget: budget || null,
          notes: notes || null,
        },
        { onConflict: "phone,area" }
      )
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    // Total waitlist count
    const { count: totalCount } = await sb
      .from("buyer_waitlist")
      .select("*", { count: "exact", head: true });

    // Area-specific count (people waiting in same area, rough match)
    const { count: areaCount } = await sb
      .from("buyer_waitlist")
      .select("*", { count: "exact", head: true })
      .ilike("area", `%${area.split(/[, ]/)[0]}%`);

    // Send email notification
    if (resendApiKey) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `Relifish Waitlist <noreply@${MAIL_DOMAIN}>`,
            to: "relifishstore@gmail.com",
            subject: `New Waitlist: ${area} — ${phoneE164}`,
            html: `
              <h2>New Buyer Waitlist Entry</h2>
              <table style="border-collapse:collapse;font-family:sans-serif;">
                <tr><td style="padding:8px;font-weight:bold;">Phone</td><td style="padding:8px;">${phoneE164}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Area</td><td style="padding:8px;">${escapeHtml(area)}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Fish wanted</td><td style="padding:8px;">${escapeHtml(fish_wanted || "—")}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Frequency</td><td style="padding:8px;">${escapeHtml(frequency || "—")}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Preference</td><td style="padding:8px;">${escapeHtml(preference || "—")}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Budget</td><td style="padding:8px;">${escapeHtml(budget || "—")}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Notes</td><td style="padding:8px;">${escapeHtml(notes || "—")}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Waitlist #</td><td style="padding:8px;">${totalCount}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">People in area</td><td style="padding:8px;">${areaCount}</td></tr>
              </table>
            `,
          }),
        });
        await sb.from("buyer_waitlist").update({ email_sent: true }).eq("id", data.id);

        // Send welcome email to customer if they provided email
        // Client-supplied text used to land unescaped in a Relifish-branded mail
        // to any address (phishing relay). All fields are escaped now; the
        // address must at least look like one.
        if (email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(email))) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: MAIL_FROM,
              to: email,
              subject: "You're on the Relifish waitlist!",
              html: `
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:500px;margin:0 auto;padding:24px;">
                  <div style="margin:0 0 16px;"><img src="${LOGO_URL}" alt="Relifish" style="height:40px;width:auto;display:block;" /></div>
                  <h1 style="font-size:24px;margin:0 0 16px;">Welcome to Relifish!</h1>
                  <p style="font-size:16px;color:#333;line-height:1.6;margin:0 0 16px;">
                    You're officially on the waitlist. We're bringing the freshest fish from local sellers to <strong>${escapeHtml(area)}</strong>.
                  </p>
                  <div style="background:#f0f6ff;border-radius:12px;padding:20px;margin:0 0 16px;">
                    <p style="font-size:14px;font-weight:700;color:#0066cc;margin:0 0 10px;">What happens next:</p>
                    <p style="font-size:14px;color:#333;line-height:1.6;margin:0;">
                      1. We onboard trusted fish sellers near ${escapeHtml(area)}<br/>
                      2. You get notified the moment they go live<br/>
                      3. You order first — with exclusive launch discounts
                    </p>
                  </div>
                  <div style="background:#fff3e0;border-radius:12px;padding:16px;margin:0 0 16px;">
                    <p style="font-size:14px;font-weight:700;color:#e65100;margin:0 0 6px;">🏷️ Your early bird perks:</p>
                    <p style="font-size:13px;color:#333;line-height:1.5;margin:0;">
                      ✅ Launch discounts from sellers<br/>
                      ✅ Best introductory prices<br/>
                      ✅ First access before anyone else<br/>
                      ✅ Early pre-order for tomorrow's catch
                    </p>
                  </div>
                  <p style="font-size:14px;color:#666;line-height:1.5;margin:0 0 16px;">
                    ${areaCount && areaCount > 1 ? `<strong>${areaCount} people</strong> near you are already waiting. ` : ""}The more interest we see, the faster we launch in your area.
                  </p>
                  <a href="https://www.relifish.com" style="display:inline-block;background:#0066cc;color:white;padding:12px 28px;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;">Browse Relifish</a>
                  <p style="font-size:12px;color:#999;margin:20px 0 0;line-height:1.5;">
                    Questions? Reply to this email or reach us at relifishstore@gmail.com<br/>
                    — Team Relifish, Mumbai
                  </p>
                </div>
              `,
            }),
          });
        }
      } catch (err) { console.warn("[waitlist/join] notify failed", { err: (err as any)?.message }); }
    }

    return new Response(
      JSON.stringify({
        success: true,
        waitlist_number: totalCount,
        area_count: areaCount,
        spots_remaining: Math.max(0, 1000 - (totalCount || 0)),
      }),
      { status: 200 }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
