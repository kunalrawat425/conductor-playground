import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const msg91AuthKey = import.meta.env.MSG91_AUTH_KEY || "";
const msg91TemplateId = import.meta.env.MSG91_TEMPLATE_ID || "";
const msg91SenderId = import.meta.env.MSG91_SENDER_ID || "RELFSH";
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

const OTP_EXPIRY_MINUTES = 10;
const MAX_SENDS_PER_DAY = 30;
const RESEND_COOLDOWN_SECONDS = 30;

function generateOTP(): string {
  // Cryptographically random 6-digit code, no leading zeros
  const min = 100000;
  const max = 999999;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

/** Returns IST date string YYYY-MM-DD */
function todayIST(): string {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}

async function sendViaMSG91(phone: string, otp: string): Promise<{ ok: boolean; error?: string }> {
  // Use Flow API — works with any approved DLT template (not OTP-type-specific)
  // Template must contain ##otp## variable
  const res = await fetch("https://api.msg91.com/api/v5/flow/", {
    method: "POST",
    headers: {
      "authkey": msg91AuthKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      flow_id: msg91TemplateId,
      sender: msg91SenderId,
      mobiles: phone,   // 91XXXXXXXXXX format
      otp,              // maps to ##otp## in template
      VAR1: otp,        // fallback if template uses ##VAR1##
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.type === "success") return { ok: true };
  return { ok: false, error: data.message || `MSG91 error (${res.status})` };
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

    // Normalise to 91XXXXXXXXXX (no +)
    const normalised = phone.replace("+", "");

    const sb = createClient(supabaseUrl, supabaseServiceKey);
    const today = todayIST();
    const now = new Date();

    // Load existing record
    const { data: row } = await sb
      .from("otp_codes")
      .select("sends_today, send_date, last_sent_at")
      .eq("phone", normalised)
      .maybeSingle();

    // Daily limit — reset counter if it's a new IST day
    const sendsToday = row && row.send_date === today ? (row.sends_today ?? 0) : 0;
    if (sendsToday >= MAX_SENDS_PER_DAY) {
      return new Response(
        JSON.stringify({ error: "Maximum 3 OTPs per day. Try again tomorrow." }),
        { status: 429 }
      );
    }

    // 30-second cooldown between sends
    if (row?.last_sent_at) {
      const elapsed = (now.getTime() - new Date(row.last_sent_at).getTime()) / 1000;
      if (elapsed < RESEND_COOLDOWN_SECONDS) {
        const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed);
        return new Response(
          JSON.stringify({ error: `Wait ${wait}s before requesting another OTP.`, wait }),
          { status: 429 }
        );
      }
    }

    // TODO: enable MSG91 when ready — for now use fixed OTP 123456
    const OTP_SEND_ENABLED = false;
    const otp = OTP_SEND_ENABLED ? generateOTP() : "123456";
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

    // Upsert: new code, reset verify attempts, bump send count
    const { error: dbErr } = await sb.from("otp_codes").upsert(
      {
        phone: normalised,
        code: otp,
        expires_at: expiresAt,
        verify_attempts: 0,
        sends_today: sendsToday + 1,
        send_date: today,
        last_sent_at: now.toISOString(),
      },
      { onConflict: "phone" }
    );
    if (dbErr) {
      console.error("OTP DB upsert error:", dbErr);
      return new Response(JSON.stringify({ error: "Failed to create OTP" }), { status: 500 });
    }

    if (OTP_SEND_ENABLED) {
      const sms = await sendViaMSG91(normalised, otp);
      if (!sms.ok) {
        return new Response(JSON.stringify({ error: sms.error || "Failed to send OTP" }), { status: 502 });
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-otp error:", err);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
};
