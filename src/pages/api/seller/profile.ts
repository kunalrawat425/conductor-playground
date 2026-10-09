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
const SELLER_EDITABLE = [
  "name", "location", "location_name", "first_name", "last_name", "email",
  "opens_at", "closes_at", "open_days", "accepts_preorder", "preorder_days", "preorder_cutoff_time",
  "has_pickup", "has_delivery", "delivery_rad", "min_order_amount",
  "delivery_fee_enabled", "delivery_fee_amount", "delivery_fee_type", "delivery_fee_per_km", "free_delivery_above",
  "lat", "lng", "push_subscription", "push_enabled", "schedule_pickup_slots",
] as const;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { seller_id, seller_phone, updates: rawUpdates } = await request.json();

    if (!seller_id || !rawUpdates || typeof rawUpdates !== "object") {
      return new Response(JSON.stringify({ error: "seller_id and updates required" }), { status: 400 });
    }

    // Only fields a seller may edit about themselves. The body used to be written
    // to the row as-is, so a fresh OTP sign-up could send {is_active:true} and
    // skip admin approval, or set email_verified / rating_avg / total_orders / phone.
    const updates: Record<string, any> = {};
    for (const k of SELLER_EDITABLE) {
      if (Object.prototype.hasOwnProperty.call(rawUpdates, k)) updates[k] = rawUpdates[k];
    }
    if (Object.keys(updates).length === 0) {
      return new Response(JSON.stringify({ error: "No editable fields in updates" }), { status: 400 });
    }
    for (const k of ["min_order_amount", "delivery_rad", "delivery_fee_amount", "delivery_fee_per_km", "free_delivery_above"]) {
      if (updates[k] === undefined) continue;
      const n = Number(updates[k]);
      if (!Number.isFinite(n) || n < 0) {
        return new Response(JSON.stringify({ error: `${k} must be a non-negative number` }), { status: 400 });
      }
      updates[k] = n;
    }
    // Same open/close time means "always open" to the server but "never open" to
    // the seller page (timing logic disagreed). The dashboard blocks it; so does the API now.
    if (updates.opens_at && updates.closes_at && String(updates.opens_at).slice(0, 5) === String(updates.closes_at).slice(0, 5)) {
      return new Response(JSON.stringify({ error: "Opening and closing time cannot be the same" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Ownership: the signed seller session, not the (public) phone.
    const { requireSeller } = await import("../../../lib/server/session");
    const denied = requireSeller(request, seller_id);
    if (denied) return denied;

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
    // BUG-19: same WGS-84 guard as buyer_addresses. A seller with garbage
    // coords breaks haversine distance → wrong delivery fee for every order.
    if (updates.lat !== undefined) {
      const n = Number(updates.lat);
      updates.lat = Number.isFinite(n) && n >= -90 && n <= 90 ? n : null;
    }
    if (updates.lng !== undefined) {
      const n = Number(updates.lng);
      updates.lng = Number.isFinite(n) && n >= -180 && n <= 180 ? n : null;
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
