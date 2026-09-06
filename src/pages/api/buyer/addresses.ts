import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

function client() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

type AddressPayload = {
  label?: string;
  flat?: string;
  building?: string;
  landmark?: string;
  location_name?: string;
  lat?: number | null;
  lng?: number | null;
  is_default?: boolean;
};

/**
 * BUG-19: validate WGS-84 coordinate ranges. Out-of-range values silently
 * break distance maths (haversine returns NaN/garbage) which then corrupts
 * delivery-fee calculation at checkout. Returns a normalised number or null.
 */
function sanitizeLat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < -90 || n > 90) return null;
  return n;
}

function sanitizeLng(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < -180 || n > 180) return null;
  return n;
}

async function clearOtherDefaults(supabase: ReturnType<typeof client>, buyer_id: string, exceptId?: string) {
  let q = supabase.from("buyer_addresses").update({ is_default: false }).eq("buyer_id", buyer_id);
  if (exceptId) q = q.neq("id", exceptId);
  await q;
}

/**
 * GET /api/buyer/addresses?buyer_id=
 */
export const GET: APIRoute = async ({ url }) => {
  try {
    const buyer_id = url.searchParams.get("buyer_id");
    if (!buyer_id) {
      return new Response(JSON.stringify({ error: "buyer_id required" }), { status: 400 });
    }
    const supabase = client();
    const { data, error } = await supabase
      .from("buyer_addresses")
      .select("*")
      .eq("buyer_id", buyer_id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    return new Response(JSON.stringify({ addresses: data || [] }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/**
 * POST /api/buyer/addresses
 * Body: { buyer_id, address: AddressPayload }
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { buyer_id, address } = (await request.json()) as { buyer_id?: string; address?: AddressPayload };
    if (!buyer_id || !address) {
      return new Response(JSON.stringify({ error: "buyer_id and address required" }), { status: 400 });
    }

    const supabase = client();
    if (address.is_default) {
      await clearOtherDefaults(supabase, buyer_id);
    }

    const row = {
      buyer_id,
      label: (address.label ?? "").trim(),
      flat: (address.flat ?? "").trim(),
      building: (address.building ?? "").trim(),
      landmark: (address.landmark ?? "").trim(),
      location_name: (address.location_name ?? "").trim(),
      lat: sanitizeLat(address.lat),
      lng: sanitizeLng(address.lng),
      is_default: !!address.is_default,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from("buyer_addresses").insert(row).select().single();
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    return new Response(JSON.stringify({ address: data }), { status: 201 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/**
 * PATCH /api/buyer/addresses
 * Body: { buyer_id, id, address: Partial<AddressPayload> }
 */
export const PATCH: APIRoute = async ({ request }) => {
  try {
    const { buyer_id, id, address } = (await request.json()) as {
      buyer_id?: string;
      id?: string;
      address?: AddressPayload;
    };
    if (!buyer_id || !id || !address) {
      return new Response(JSON.stringify({ error: "buyer_id, id, and address required" }), { status: 400 });
    }

    const supabase = client();
    if (address.is_default) {
      await clearOtherDefaults(supabase, buyer_id, id);
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (address.label !== undefined) updates.label = String(address.label).trim();
    if (address.flat !== undefined) updates.flat = String(address.flat).trim();
    if (address.building !== undefined) updates.building = String(address.building).trim();
    if (address.landmark !== undefined) updates.landmark = String(address.landmark).trim();
    if (address.location_name !== undefined) updates.location_name = String(address.location_name).trim();
    if (address.lat !== undefined) updates.lat = sanitizeLat(address.lat);
    if (address.lng !== undefined) updates.lng = sanitizeLng(address.lng);
    if (address.is_default !== undefined) updates.is_default = !!address.is_default;

    const { data, error } = await supabase
      .from("buyer_addresses")
      .update(updates)
      .eq("id", id)
      .eq("buyer_id", buyer_id)
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    return new Response(JSON.stringify({ address: data }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

/**
 * DELETE /api/buyer/addresses
 * Body: { buyer_id, id }
 */
export const DELETE: APIRoute = async ({ request }) => {
  try {
    const { buyer_id, id } = (await request.json()) as { buyer_id?: string; id?: string };
    if (!buyer_id || !id) {
      return new Response(JSON.stringify({ error: "buyer_id and id required" }), { status: 400 });
    }
    const supabase = client();
    const { error } = await supabase.from("buyer_addresses").delete().eq("id", id).eq("buyer_id", buyer_id);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
