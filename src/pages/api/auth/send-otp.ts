import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { normalizeIndianMobile } from "../../../lib/indian-phone";
import { otpDevBypassAllowed } from "../../../lib/server/otp-mode";
import { clientKey, overLimit } from "../../../lib/server/rate-limit";

export const prerender = false;

const msg91AuthKey = import.meta.env.MSG91_AUTH_KEY || "";
const msg91TemplateId = import.meta.env.MSG91_TEMPLATE_ID || "";
const msg91SenderId = import.meta.env.MSG91_SENDER_ID || "RELFSH";
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

const OTP_EXPIRY_MINUTES = 10;
const MAX_SENDS_PER_DAY = 10;
const RESEND_COOLDOWN_SECONDS = 30;
// SMS pumping guards: limits were per phone only, so a script looping over
// numbers could send unlimited paid SMS. Per-IP (per instance) + a global
// daily ceiling. ponytail: in-memory IP buckets and a sum over otp_codes —
// move to Vercel KV / a counter row if real traffic approaches the ceiling.
const MAX_SENDS_PER_IP_10MIN = 5;
const MAX_SENDS_GLOBAL_PER_DAY = 500;

/**
 * Uniform 6-digit code from a CSPRNG. The old "pattern friendly" generator
 * (AAABBB / ABABAB / ABCABC / AABBCC from Math.random) produced ~1,458 possible
 * codes, not 1,000,000: with 3 guesses per code and many sends a day, an
 * attacker had roughly a 1-in-16 daily chance of logging in as any phone.
 */
function generateOTP(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Returns IST date string YYYY-MM-DD */
function todayIST(): string {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}

async function sendViaMSG91(phone: string, otp: string): Promise<{ ok: boolean; error?: string }> {
  // Use Flow API — works with any approved DLT template (not OTP-type-specific)
  const payload = {
    flow_id: msg91TemplateId,
    sender: msg91SenderId,
    mobiles: phone,   // 91XXXXXXXXXX format
    var: otp,         // maps to ##var## in template
    otp,              // maps to ##otp## in template
    VAR1: otp,        // fallback if template uses ##VAR1##
  };

  const res = await fetch("https://api.msg91.com/api/v5/flow/", {
    method: "POST",
    headers: {
      "authkey": msg91AuthKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  
  // Never log the payload or the full response: both carry the OTP / phone.
  if (data.type !== "success") console.warn("[send-otp] MSG91 rejected", { status: res.status, type: data.type });

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

    // Same normalisation as verify-otp and every other phone column, so the
    // otp_codes key can never drift from what verify looks up.
    const parsed = normalizeIndianMobile(String(phone ?? ""));
    if (!parsed.ok) {
      return new Response(JSON.stringify({ error: parsed.message }), { status: 400 });
    }
    // otp_codes key + MSG91 format: 91XXXXXXXXXX (no +)
    const normalised = "91" + parsed.digits10;

    if (overLimit(`send-otp:${clientKey(request)}`, MAX_SENDS_PER_IP_10MIN, 10 * 60 * 1000)) {
      return new Response(JSON.stringify({ error: "Too many OTP requests. Try again in a few minutes." }), { status: 429 });
    }

    const sb = createClient(supabaseUrl, supabaseServiceKey);
    const today = todayIST();
    const now = new Date();

    const { data: todays } = await sb.from("otp_codes").select("sends_today").eq("send_date", today);
    const globalSends = (todays || []).reduce((n: number, r: any) => n + (Number(r.sends_today) || 0), 0);
    if (globalSends >= MAX_SENDS_GLOBAL_PER_DAY) {
      console.error("[send-otp] global daily OTP ceiling reached", { globalSends });
      return new Response(JSON.stringify({ error: "Login is busy right now. Please try again later." }), { status: 503 });
    }

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
        JSON.stringify({ error: `Maximum ${MAX_SENDS_PER_DAY} OTPs per day. Try again tomorrow.` }),
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

    // Toggle MSG91 via env variable
    const OTP_SEND_ENABLED = import.meta.env.PUBLIC_ENABLE_MSG91 === "true";
    if (!OTP_SEND_ENABLED && !otpDevBypassAllowed()) {
      console.error("[send-otp] MSG91 disabled outside dev — refusing to issue the fixed dev code");
      return new Response(JSON.stringify({ error: "Login is temporarily unavailable" }), { status: 503 });
    }
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
