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
/**
 * BUG-36: the wrong-code branch did `update({ verify_attempts: row.verify_attempts + 1 })`
 * using a value from an earlier SELECT. Concurrent guesses all read the same
 * number and all write the same increment, so the counter barely moves —
 * measured: 20 parallel wrong guesses took verify_attempts from 0 to 1. The
 * 3-attempt limit was defeated by parallelism, leaving a 6-digit code brute
 * forceable in batches.
 *
 * Compare-and-swap instead: the UPDATE only applies while verify_attempts is
 * still the value we read, so exactly one racer wins per round. Losers re-read
 * and retry, which also re-applies the limit check. No migration needed.
 *
 * Returns the attempt count after this guess, or null if it could not be
 * recorded (caller must then fail closed rather than grant a free guess).
 */
async function recordFailedAttempt(sb: any, phone: string, maxAttempts: number): Promise<number | null> {
  for (let round = 0; round < 6; round++) {
    const { data: cur, error: readErr } = await sb
      .from("otp_codes")
      .select("verify_attempts")
      .eq("phone", phone)
      .maybeSingle();
    if (readErr || !cur) {
      console.warn("[verify-otp] could not read verify_attempts", { phone, err: readErr?.message });
      return null;
    }
    const expected = Number(cur.verify_attempts) || 0;
    if (expected >= maxAttempts) return expected;

    const { data: won, error: casErr } = await sb
      .from("otp_codes")
      .update({ verify_attempts: expected + 1 })
      .eq("phone", phone)
      .eq("verify_attempts", expected)
      .select("verify_attempts");
    if (casErr) {
      console.warn("[verify-otp] attempt increment failed", { phone, err: casErr.message });
      return null;
    }
    if (won && won.length > 0) return Number(won[0].verify_attempts);
    // Lost the race — another guess incremented first. Re-read and retry.
  }
  console.warn("[verify-otp] attempt increment gave up after 6 contended rounds", { phone });
  return null;
}

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
        const attempts = await recordFailedAttempt(sb, normalised, MAX_VERIFY_ATTEMPTS);

        // If the attempt could not be recorded, fail closed. Granting a guess
        // we cannot count is what made brute force viable in the first place.
        if (attempts === null) {
          return new Response(
            JSON.stringify({ error: "Could not verify right now. Request a new OTP." }),
            { status: 503 }
          );
        }

        const left = Math.max(0, MAX_VERIFY_ATTEMPTS - attempts);
        const msg = left > 0
          ? `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.`
          : "No tries left. Request a new OTP.";
        return new Response(JSON.stringify({ error: msg, tries_left: left }), { status: 401 });
      }

      // Valid — burn the code (set to expired so it can't be reused).
      // BUG-37: this error was discarded, so a failed burn left the code live
      // for replay until its natural expiry with nothing logged. Replay still
      // requires knowing the code, so this is hygiene rather than a gate — we
      // log loudly instead of failing a login the user has already earned.
      const { error: burnErr } = await sb
        .from("otp_codes")
        .update({ expires_at: new Date().toISOString(), verify_attempts: MAX_VERIFY_ATTEMPTS })
        .eq("phone", normalised);
      if (burnErr) {
        console.error("[verify-otp] FAILED TO BURN OTP — code stays valid until expiry", {
          phone: normalised, err: burnErr.message,
        });
      }
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
