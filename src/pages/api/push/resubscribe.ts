import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/** A subscription a browser could have produced: https endpoint + both keys. */
export function validSubscription(s: any): boolean {
  return !!s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000
    && typeof s.keys?.p256dh === "string" && typeof s.keys?.auth === "string";
}

/**
 * POST /api/push/resubscribe  { old_endpoint, subscription }
 * Called by sw.js on `pushsubscriptionchange`, which has no login session. The old endpoint is
 * an unguessable capability URL, so holding it is the proof: we only replace rows that stored it.
 */
export const POST: APIRoute = async ({ request }) => {
  let b: any;
  try { b = await request.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 }); }
  const oldEndpoint = typeof b?.old_endpoint === "string" ? b.old_endpoint : "";
  if (!/^https:\/\//.test(oldEndpoint) || !validSubscription(b?.subscription)) {
    return new Response(JSON.stringify({ error: "old_endpoint and a valid subscription are required" }), { status: 400 });
  }
  const sb = createClient(supabaseUrl, supabaseServiceKey);
  const patch = { push_subscription: b.subscription, push_enabled: true };
  const [buyers, sellers] = await Promise.all([
    sb.from("buyers").update(patch).eq("push_subscription->>endpoint", oldEndpoint).select("id"),
    sb.from("sellers").update(patch).eq("push_subscription->>endpoint", oldEndpoint).select("id"),
  ]);
  if (buyers.error || sellers.error) {
    return new Response(JSON.stringify({ error: (buyers.error || sellers.error)!.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ updated: (buyers.data?.length || 0) + (sellers.data?.length || 0) }), { status: 200 });
};
