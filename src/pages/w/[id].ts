import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

/** GET /w/<id>: a shared greeting card → /diwali-wishes showing that card ("<name> sent you a card"). */
// Link previews (WhatsApp, Facebook, Telegram...) and crawlers fetch the link too; they are logged but not counted.
const BOT = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|skype|curl|python|headless/i;

export const GET: APIRoute = async ({ params, redirect, request }) => {
  const id = String(params.id || "");
  if (!/^[A-Za-z0-9]{7}$/.test(id)) return redirect("/diwali-wishes", 302);
  const sb = createClient(import.meta.env.PUBLIC_SUPABASE_URL || "", import.meta.env.SUPABASE_SERVICE_KEY || "");
  const { data: c } = await sb.from("greeting_cards").select("theme, message, sign, opens").eq("id", id).maybeSingle();
  if (!c) return redirect("/diwali-wishes", 302);
  const ua = request.headers.get("user-agent") || "";
  const bot = !ua || BOT.test(ua);
  await sb.from("card_opens").insert({ card_id: id, bot, ua: ua.slice(0, 300), referer: (request.headers.get("referer") || "").slice(0, 300) || null });
  if (!bot) await sb.from("greeting_cards").update({ opens: (c.opens || 0) + 1 }).eq("id", id);
  const q = new URLSearchParams({ t: c.theme, m: c.message, f: c.sign, utm_source: "share", utm_medium: "card", utm_campaign: "diwali_card", utm_content: id });
  return redirect(`/diwali-wishes?${q}`, 302);
};
