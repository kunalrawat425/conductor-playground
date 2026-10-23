import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

/**
 * GET /go/<message_id>: the target of every WhatsApp/push button. Records the first tap
 * (message_log.clicked_at), then redirects to the message's page with UTMs so GA, Clarity and
 * orders.utm_* see which message brought the visit. Unknown id → /shop.
 */
export const GET: APIRoute = async ({ params, redirect }) => {
  const id = String(params.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return redirect("/shop", 302);
  const sb = createClient(import.meta.env.PUBLIC_SUPABASE_URL || "", import.meta.env.SUPABASE_SERVICE_KEY || "");
  const { data: m } = await sb.from("message_log").select("id, kind, channel, link_path, clicked_at").eq("id", id).maybeSingle();
  if (!m) return redirect("/shop", 302);
  if (!m.clicked_at) await sb.from("message_log").update({ clicked_at: new Date().toISOString() }).eq("id", id);
  const path = typeof m.link_path === "string" && m.link_path.startsWith("/") && !m.link_path.startsWith("//") ? m.link_path : "/shop";
  const sep = path.includes("?") ? "&" : "?";
  return redirect(`${path}${sep}utm_source=${m.channel}&utm_medium=message&utm_campaign=${encodeURIComponent(m.kind)}&utm_content=${id}`, 302);
};
