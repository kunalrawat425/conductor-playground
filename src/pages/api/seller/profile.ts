import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * POST /api/seller/profile
 * Body: { seller_id, seller_phone, updates: { ... } }
 * Uses service_role key to bypass RLS.
 *
 * BUG-12 fix: seller_id is publicly exposed in /api/search responses, so it
 * cannot be used alone as a bearer credential. Require seller_phone (stored
 * in localStorage.rlf_seller_phone at OTP verify time) and verify it matches
 * the row's phone before allowing any update.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { seller_id, seller_phone, updates } = await request.json();

    if (!seller_id || !updates) {
      return new Response(JSON.stringify({ error: "seller_id and updates required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Ownership: seller_phone must match the row (BUG-12).
    // Strip leading +/91 prefixes both sides for comparison consistency.
    const norm = (s: string) => (s || "").replace(/^\+?91/, "").replace(/^\+/, "").replace(/\D/g, "");
    const { data: owner } = await supabase.from("sellers").select("phone").eq("id", seller_id).single();
    if (!owner) {
      return new Response(JSON.stringify({ error: "Seller not found" }), { status: 404 });
    }
    if (!seller_phone || norm(String(seller_phone)) !== norm(String(owner.phone))) {
      return new Response(JSON.stringify({ error: "Unauthorized — seller phone mismatch" }), { status: 403 });
    }

    // Reset email_verified if email changed
    if (updates.email !== undefined) {
      const { data: current } = await supabase.from("sellers").select("email").eq("id", seller_id).single();
      if (current && current.email !== (updates.email?.trim() || null)) {
        updates.email_verified = false;
      }
    }

    // Cross-table uniqueness: email and phone must not exist in buyers table
    if (updates.email && typeof updates.email === "string" && updates.email.trim()) {
      const email = updates.email.trim();
      const { data: existingBuyer } = await supabase
        .from("buyers")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (existingBuyer) {
        return new Response(
          JSON.stringify({ error: "That email is already registered as a buyer. Use a different email." }),
          { status: 409 }
        );
      }
    }
    if (updates.phone && typeof updates.phone === "string" && updates.phone.trim()) {
      const phone = updates.phone.trim();
      const { data: existingBuyer } = await supabase
        .from("buyers")
        .select("id")
        .eq("phone", phone)
        .maybeSingle();
      if (existingBuyer) {
        return new Response(
          JSON.stringify({ error: "That phone number is already registered as a buyer." }),
          { status: 409 }
        );
      }
    }

    const touchesFulfillment =
      Object.prototype.hasOwnProperty.call(updates, "has_pickup") ||
      Object.prototype.hasOwnProperty.call(updates, "has_delivery");
    if (touchesFulfillment) {
      const { data: cur } = await supabase
        .from("sellers")
        .select("has_pickup, has_delivery")
        .eq("id", seller_id)
        .single();
      const nextPickup =
        updates.has_pickup !== undefined ? !!updates.has_pickup : cur?.has_pickup !== false;
      const nextDelivery =
        updates.has_delivery !== undefined ? !!updates.has_delivery : !!cur?.has_delivery;
      if (!nextPickup && !nextDelivery) {
        return new Response(
          JSON.stringify({
            error: "Enable at least pickup or delivery so buyers can receive orders.",
          }),
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabase
      .from("sellers")
      .update(updates)
      .eq("id", seller_id)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        const msg = (error.message || "").toLowerCase();
        const human =
          msg.includes("email") || msg.includes("sellers_email")
            ? "That email is already in use. Email is case-sensitive."
            : msg.includes("phone")
              ? "That phone number is already registered."
              : "This value is already in use.";
        return new Response(JSON.stringify({ error: human }), { status: 409 });
      }
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ seller: data }), { status: 200 });
  } catch (err: any) {
    console.error("Seller profile error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
