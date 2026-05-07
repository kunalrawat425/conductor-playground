import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { verifyEmailTemplate } from "../../../lib/email-templates";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";
const secret = import.meta.env.SUPABASE_SERVICE_KEY || "fallback-secret";

function makeToken(role: string, id: string, email: string): string {
  return createHmac("sha256", secret)
    .update(`${role}:${id}:${email}`)
    .digest("hex");
}

/**
 * POST /api/auth/verify-email — send verification email
 * Body: { role: "seller"|"buyer", id, email }
 */
export const POST: APIRoute = async ({ request, url }) => {
  try {
    const body = await request.json();
    const { role, id, email } = body;
    console.log("[verify-email] POST payload:", JSON.stringify(body));
    if (!role || !id || !email) {
      console.error("[verify-email] Missing fields — role:", role, "id:", id, "email:", email);
      return new Response(JSON.stringify({ error: "role, id, email required" }), { status: 400 });
    }
    if (!resendApiKey) {
      console.error("[verify-email] RESEND_API_KEY is empty/missing");
      return new Response(JSON.stringify({ error: "Email service not configured" }), { status: 500 });
    }

    const table = role === "seller" ? "sellers" : "buyers";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check email matches DB
    const { data: record, error: dbErr } = await supabase.from(table).select("email").eq("id", id).single();
    console.log("[verify-email] DB lookup:", { table, id, record, dbErr: dbErr?.message });
    if (!record || record.email !== email) {
      console.error("[verify-email] Email mismatch — DB:", record?.email, "payload:", email);
      return new Response(JSON.stringify({ error: "Email mismatch. Save profile first." }), { status: 400 });
    }

    const token = makeToken(role, id, email);
    const verifyUrl = `${url.origin}/api/auth/verify-email?token=${token}&role=${role}&id=${id}&email=${encodeURIComponent(email)}`;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Relifish <noreply@relifish.store>",
        to: email,
        subject: "Verify your email — Relifish",
        html: verifyEmailTemplate(email, verifyUrl),
      }),
    });

    if (!emailRes.ok) {
      const errData = await emailRes.json().catch(() => ({}));
      console.error("[verify-email] Resend API error:", emailRes.status, JSON.stringify(errData));
      return new Response(JSON.stringify({ error: errData.message || "Failed to send verification email" }), { status: 500 });
    }

    const resendData = await emailRes.json().catch(() => ({}));
    console.log("[verify-email] Resend success:", JSON.stringify(resendData));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    console.error("[verify-email] Unhandled POST error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/**
 * GET /api/auth/verify-email?token=...&role=...&id=...&email=...
 * Verifies token and sets email_verified = true
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const token = url.searchParams.get("token") || "";
    const role = url.searchParams.get("role") || "";
    const id = url.searchParams.get("id") || "";
    const email = url.searchParams.get("email") || "";

    if (!token || !role || !id || !email) {
      return new Response("<h1>Invalid link</h1>", { status: 400, headers: { "Content-Type": "text/html" } });
    }

    const expected = makeToken(role, id, email);
    if (token !== expected) {
      return new Response("<h1>Invalid or expired link</h1>", { status: 400, headers: { "Content-Type": "text/html" } });
    }

    const table = role === "seller" ? "sellers" : "buyers";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Only verify if email still matches
    const { data: record } = await supabase.from(table).select("email").eq("id", id).single();
    if (!record || record.email !== email) {
      return new Response("<h1>Email changed since verification was sent</h1>", { status: 400, headers: { "Content-Type": "text/html" } });
    }

    await supabase.from(table).update({ email_verified: true }).eq("id", id);

    const redirect = role === "seller" ? "/dashboard/profile" : "/me";
    return new Response(`
      <html><head><meta charset="utf-8"><meta http-equiv="refresh" content="2;url=${redirect}"></head>
      <body style="font-family:Inter,sans-serif;text-align:center;padding:60px 24px;">
        <div style="font-size:48px;margin-bottom:16px;">✅</div>
        <h1 style="font-size:22px;margin:0 0 8px;">Email verified!</h1>
        <p style="color:#666;">Redirecting back...</p>
      </body></html>
    `, { status: 200, headers: { "Content-Type": "text/html" } });
  } catch (err: any) {
    return new Response(`<h1>Error: ${err.message}</h1>`, { status: 500, headers: { "Content-Type": "text/html" } });
  }
};
