import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

/** GET /w/<id>: a shared greeting card → /diwali-wishes showing that card ("<name> sent you a card"). */
export const GET: APIRoute = async ({ params, redirect }) => {
  const id = String(params.id || "");
  if (!/^[A-Za-z0-9]{7}$/.test(id)) return redirect("/diwali-wishes", 302);
  const sb = createClient(import.meta.env.PUBLIC_SUPABASE_URL || "", import.meta.env.SUPABASE_SERVICE_KEY || "");
  const { data: c } = await sb.from("greeting_cards").select("theme, message, sign, opens").eq("id", id).maybeSingle();
  if (!c) return redirect("/diwali-wishes", 302);
  await sb.from("greeting_cards").update({ opens: (c.opens || 0) + 1 }).eq("id", id);
  const q = new URLSearchParams({ t: c.theme, m: c.message, f: c.sign, utm_source: "share", utm_medium: "card", utm_campaign: "diwali_card", utm_content: id });
  return redirect(`/diwali-wishes?${q}`, 302);
};
