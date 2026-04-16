import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const accountSid = import.meta.env.TWILIO_ACCOUNT_SID || "";
const authToken = import.meta.env.TWILIO_AUTH_TOKEN || "";
const serviceSid = import.meta.env.TWILIO_VERIFY_SERVICE_SID || "";
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;
const BLOCK_MINUTES = 30;

async function checkRateLimit(phone: string): Promise<{ allowed: boolean; error?: string }> {
  if (!supabaseUrl || !supabaseServiceKey) return { allowed: true };
  const sb = createClient(supabaseUrl, supabaseServiceKey);

  const { data: row } = await sb.from("otp_attempts").select("*").eq("phone", phone).single();

  if (row?.blocked_until && new Date(row.blocked_until) > new Date()) {
    const mins = Math.ceil((new Date(row.blocked_until).getTime() - Date.now()) / 60000);
    return { allowed: false, error: `Too many attempts. Try again in ${mins} minutes.` };
  }

  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60000);

  if (row && row.attempts >= MAX_ATTEMPTS && new Date(row.first_attempt) > windowStart) {
    const blockedUntil = new Date(Date.now() + BLOCK_MINUTES * 60000).toISOString();
    await sb.from("otp_attempts").update({ blocked_until: blockedUntil }).eq("phone", phone);
    return { allowed: false, error: `Too many attempts. Blocked for ${BLOCK_MINUTES} minutes.` };
  }

  if (row && new Date(row.first_attempt) > windowStart) {
    await sb.from("otp_attempts").update({ attempts: row.attempts + 1 }).eq("phone", phone);
  } else {
    await sb.from("otp_attempts").upsert({ phone, attempts: 1, first_attempt: new Date().toISOString(), blocked_until: null }, { onConflict: "phone" });
  }

  return { allowed: true };
}

/**
 * POST /api/auth/send-otp
 * Body: { phone: "+919876543210" }
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { phone } = await request.json();

    if (!phone || phone.length < 12) {
      return new Response(JSON.stringify({ error: "Invalid phone number" }), { status: 400 });
    }

    // Rate limit check
    const rateCheck = await checkRateLimit(phone);
    if (!rateCheck.allowed) {
      return new Response(JSON.stringify({ error: rateCheck.error }), { status: 429 });
    }

    // DEV MODE: If Twilio not configured, hardcode OTP as 123456
    const twilioConfigured = accountSid && authToken && serviceSid
      && !accountSid.startsWith("your-") && !authToken.startsWith("your-");
    if (!twilioConfigured) {
      if (import.meta.env.DEV) {
        console.info(`[DEV] OTP for ${phone}: 123456`);
      }
      return new Response(JSON.stringify({ success: true, status: "pending", dev: true }), { status: 200 });
    }

    const res = await fetch(
      `https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
        },
        body: new URLSearchParams({ To: phone, Channel: "sms" }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data.message || "Failed to send OTP" }), { status: res.status });
    }

    return new Response(JSON.stringify({ success: true, status: data.status }), { status: 200 });
  } catch (err: any) {
    console.error("Send OTP error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
