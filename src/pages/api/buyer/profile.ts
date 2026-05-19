import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * POST /api/buyer/profile
 * Body: { buyer_id, updates: { first_name, last_name, email, ... } }
 * Uses service_role key to bypass RLS
 */
const ALLOWED_BUYER_FIELDS = ["first_name", "last_name", "email"] as const;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { buyer_id, updates } = await request.json();

    if (!buyer_id || !updates || typeof updates !== "object") {
      return new Response(JSON.stringify({ error: "buyer_id and updates required" }), { status: 400 });
    }

    const sanitized: Record<string, string | null> = {};
    for (const key of ALLOWED_BUYER_FIELDS) {
      if (updates[key] === undefined) continue;
      const raw = updates[key];
      if (key === "email") {
        const t = typeof raw === "string" ? raw.trim() : "";
        sanitized.email = t === "" ? null : t;
      } else {
        const t = typeof raw === "string" ? raw.trim() : "";
        sanitized[key] = t === "" ? null : t;
      }
    }

    if (Object.keys(sanitized).length === 0) {
      return new Response(JSON.stringify({ error: "No allowed fields to update" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Reset email_verified if email changed
    if (sanitized.email !== undefined) {
      const { data: current } = await supabase.from("buyers").select("email").eq("id", buyer_id).single();
      if (current && current.email !== sanitized.email) {
        (sanitized as any).email_verified = false;
      }
    }

    // Uniqueness: same checks as seller profile (cross-table + no other buyer with this email)
    if (sanitized.email && typeof sanitized.email === "string") {
      const email = sanitized.email;
      const { data: existingSeller } = await supabase
        .from("sellers")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (existingSeller) {
        return new Response(
          JSON.stringify({ error: "That email is already registered as a seller. Use a different email." }),
          { status: 409 }
        );
      }
      const { data: otherBuyer } = await supabase
        .from("buyers")
        .select("id")
        .eq("email", email)
        .neq("id", buyer_id)
        .maybeSingle();
      if (otherBuyer) {
        return new Response(
          JSON.stringify({ error: "That email is already in use. Email is case-sensitive." }),
          { status: 409 }
        );
      }
    }

    const { data, error } = await supabase
      .from("buyers")
      .update(sanitized)
      .eq("id", buyer_id)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        const msg = (error.message || "").toLowerCase();
        const human =
          msg.includes("email") || msg.includes("buyers_email")
            ? "That email is already in use. Email is case-sensitive."
            : msg.includes("phone")
              ? "That phone number is already registered."
              : "This value is already in use.";
        return new Response(JSON.stringify({ error: human }), { status: 409 });
      }
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ buyer: data }), { status: 200 });
  } catch (err: any) {
    console.error("Buyer profile error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/**
 * GET /api/buyer/profile?buyer_id=xxx
 * Fetch buyer profile
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const buyer_id = url.searchParams.get("buyer_id");
    if (!buyer_id) {
      return new Response(JSON.stringify({ error: "buyer_id required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from("buyers")
      .select("id, phone, first_name, last_name, email, email_verified, location_name, created_at, push_enabled")
      .eq("id", buyer_id)
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ profile: data }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
