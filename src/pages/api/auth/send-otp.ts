import type { APIRoute } from "astro";

export const prerender = false;

const accountSid = import.meta.env.TWILIO_ACCOUNT_SID || "";
const authToken = import.meta.env.TWILIO_AUTH_TOKEN || "";
const serviceSid = import.meta.env.TWILIO_VERIFY_SERVICE_SID || "";

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

    // DEV MODE: If Twilio not configured (or placeholder values), hardcode OTP as 123456
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
