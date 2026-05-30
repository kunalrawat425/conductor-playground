import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

const MAX_VERIFY_ATTEMPTS = 3;

/**
 * POST /api/auth/verify-otp
 * Body: { phone: "+919876543210", code: "123456", role?: "seller" }
 * Returns: { success, buyer_id?, seller_id?, phone, is_active? }
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { phone, code, role } = await request.json();

    if (!phone || !code) {
      return new Response(JSON.stringify({ error: "Phone and code required" }), { status: 400 });
    }

    const normalised = phone.replace("+", "");
    const sb = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch OTP record
    const { data: row, error: fetchErr } = await sb
      .from("otp_codes")
      .select("code, expires_at, verify_attempts")
      .eq("phone", normalised)
      .maybeSingle();

    if (fetchErr) {
      console.error("OTP fetch error:", fetchErr);
      return new Response(JSON.stringify({ error: "Verification failed" }), { status: 500 });
    }

    // Toggle MSG91 via env variable
    const OTP_SEND_ENABLED = import.meta.env.PUBLIC_ENABLE_MSG91 === "true";
    const msg91Configured = OTP_SEND_ENABLED && !!(import.meta.env.MSG91_AUTH_KEY && import.meta.env.MSG91_TEMPLATE_ID);
    if (!msg91Configured) {
      if (code !== "123456") {
        return new Response(JSON.stringify({ error: "Invalid OTP (dev mode: use 123456)" }), { status: 401 });
      }
      // Skip DB check in dev mode — fall through to user upsert
    } else {
      if (!row) {
        return new Response(JSON.stringify({ error: "No OTP sent to this number" }), { status: 401 });
      }

      if (row.verify_attempts >= MAX_VERIFY_ATTEMPTS) {
        return new Response(
          JSON.stringify({ error: "Too many wrong attempts. Request a new OTP." }),
          { status: 429 }
        );
      }

      if (new Date(row.expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: "OTP expired. Request a new one." }), { status: 401 });
      }

      if (row.code !== code) {
        // Increment verify_attempts
        await sb
          .from("otp_codes")
          .update({ verify_attempts: row.verify_attempts + 1 })
          .eq("phone", normalised);

        const left = MAX_VERIFY_ATTEMPTS - (row.verify_attempts + 1);
        const msg = left > 0
          ? `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.`
          : "No tries left. Request a new OTP.";
        return new Response(JSON.stringify({ error: msg, tries_left: left }), { status: 401 });
      }

      // Valid — burn the code (set to expired so it can't be reused)
      await sb
        .from("otp_codes")
        .update({ expires_at: new Date().toISOString(), verify_attempts: MAX_VERIFY_ATTEMPTS })
        .eq("phone", normalised);
    }

    // OTP verified — upsert user
    const cleanPhone = normalised.replace("91", "").replace(/\D/g, "").slice(-10);

    if (role === "seller") {
      const { data: existing } = await sb
        .from("sellers")
        .select("id, name, phone, is_active")
        .eq("phone", cleanPhone)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ success: true, seller_id: existing.id, name: existing.name, is_active: existing.is_active !== false }),
          { status: 200 }
        );
      }

      const phoneSuffix = cleanPhone.slice(-4);
      const { data: newSeller, error } = await sb
        .from("sellers")
        .insert({ phone: cleanPhone, name: `Seller ${phoneSuffix}`, location: "", location_name: "", is_active: false })
        .select("id, name, is_active")
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: "Failed to create seller: " + error.message }), { status: 500 });
      }

      return new Response(
        JSON.stringify({ success: true, seller_id: newSeller.id, name: newSeller.name, is_active: newSeller.is_active !== false }),
        { status: 200 }
      );
    }

    // Buyer
    const { data: existing } = await sb
      .from("buyers")
      .select("id, phone, is_active")
      .eq("phone", cleanPhone)
      .maybeSingle();

    let buyer_id: string;
    let is_active = true;

    if (existing) {
      buyer_id = existing.id;
      is_active = existing.is_active !== false;
    } else {
      const { data: newBuyer, error } = await sb
        .from("buyers")
        .insert({ phone: cleanPhone })
        .select("id, is_active")
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: "Failed to create buyer: " + error.message }), { status: 500 });
      }
      buyer_id = newBuyer.id;
      is_active = newBuyer.is_active !== false;
    }

    return new Response(JSON.stringify({ success: true, buyer_id, is_active }), { status: 200 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("verify-otp error:", err);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
};
