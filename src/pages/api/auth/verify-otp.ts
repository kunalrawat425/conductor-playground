import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const accountSid = import.meta.env.TWILIO_ACCOUNT_SID || "";
const authToken = import.meta.env.TWILIO_AUTH_TOKEN || "";
const serviceSid = import.meta.env.TWILIO_VERIFY_SERVICE_SID || "";
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * POST /api/auth/verify-otp
 * Body: { phone: "+919876543210", code: "123456", role?: "seller" }
 * Returns: { success, buyer_id?, seller_id?, phone }
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { phone, code, role } = await request.json();

    if (!phone || !code) {
      return new Response(JSON.stringify({ error: "Phone and code required" }), { status: 400 });
    }

    const isTwilioConfigured = accountSid && authToken && serviceSid
      && !accountSid.startsWith("your-") && !authToken.startsWith("your-");

    // DEV MODE: Accept "123456" as valid OTP when Twilio not configured
    if (!isTwilioConfigured) {
      if (code !== "123456") {
        return new Response(JSON.stringify({ error: "Invalid OTP (dev mode: use 123456)" }), { status: 401 });
      }
    } else {
      // Verify OTP with Twilio
      const res = await fetch(
        `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
          },
          body: new URLSearchParams({ To: phone, Code: code }),
        }
      );

      const data = await res.json();

      if (!res.ok || data.status !== "approved") {
        return new Response(JSON.stringify({ error: "Invalid OTP" }), { status: 401 });
      }
    }

    // OTP verified — upsert user in database
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const cleanPhone = phone.replace("+91", "").replace(/\D/g, "");

    if (role === "seller") {
      // Seller login — find or create seller
      const { data: existing } = await supabase
        .from("sellers")
        .select("id, name, phone")
        .eq("phone", cleanPhone)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ success: true, seller_id: existing.id, name: existing.name, phone: cleanPhone }),
          { status: 200 }
        );
      }

      // Create new seller
      const { data: newSeller, error } = await supabase
        .from("sellers")
        .insert({ phone: cleanPhone, name: "New Seller", location: "", location_name: "" })
        .select("id, name")
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: "Failed to create seller: " + error.message }), { status: 500 });
      }

      return new Response(
        JSON.stringify({ success: true, seller_id: newSeller.id, name: newSeller.name, phone: cleanPhone }),
        { status: 200 }
      );
    }

    // Buyer login
    const { data: existing } = await supabase
      .from("buyers")
      .select("id, phone")
      .eq("phone", cleanPhone)
      .maybeSingle();

    let buyer_id: string;

    if (existing) {
      buyer_id = existing.id;
    } else {
      const { data: newBuyer, error } = await supabase
        .from("buyers")
        .insert({ phone: cleanPhone })
        .select("id")
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: "Failed to create buyer: " + error.message }), { status: 500 });
      }
      buyer_id = newBuyer.id;
    }

    return new Response(
      JSON.stringify({ success: true, buyer_id, phone: cleanPhone }),
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Verify OTP error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
