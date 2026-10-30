import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

/**
 * GET /go/<message_id | short_id>: the target of every WhatsApp button and SMS link. Records the first tap
 * (message_log.clicked_at), then redirects to the message's page with UTMs so GA, Clarity and
 * orders.utm_* see which message brought the visit: utm_medium = channel (whatsapp/sms), utm_source = buyer id,
 * utm_campaign = message kind, utm_content = message id. Unknown id → /shop.
 */
export const GET: APIRoute = async ({ params, redirect }) => {
  const id = String(params.id || "");
  // WhatsApp buttons carry the message uuid; SMS links the 10-char short_id (a DLT variable is ≤ 30 chars).
  const col = /^[0-9a-f-]{36}$/i.test(id) ? "id" : /^[0-9a-f]{10}$/i.test(id) ? "short_id" : null;
  if (!col) return redirect("/shop", 302);
  const sb = createClient(import.meta.env.PUBLIC_SUPABASE_URL || "", import.meta.env.SUPABASE_SERVICE_KEY || "");
  const { data: m } = await sb.from("message_log").select("id, kind, channel, buyer_id, link_path, clicked_at").eq(col, id.toLowerCase()).maybeSingle();
  if (!m) return redirect("/shop", 302);
  if (!m.clicked_at) await sb.from("message_log").update({ clicked_at: new Date().toISOString() }).eq("id", m.id);
  const path = typeof m.link_path === "string" && m.link_path.startsWith("/") && !m.link_path.startsWith("//") ? m.link_path : "/shop";
  const sep = path.includes("?") ? "&" : "?";
  return redirect(`${path}${sep}utm_source=${encodeURIComponent(m.buyer_id || "unknown")}&utm_medium=${m.channel}&utm_campaign=${encodeURIComponent(m.kind)}&utm_content=${m.id}`, 302);
};
