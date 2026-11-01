import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

/** POST {t, m, f, from?} → {id}: saves a shared greeting card so its short link /w/<id> can show it. */
// ponytail: no rate limit; add one (per IP) if the table ever fills with junk.
export const POST: APIRoute = async ({ request }) => {
  const b = await request.json().catch(() => null);
  const from = /^[A-Za-z0-9]{7}$/.test(String(b?.from || "")) ? String(b.from) : null; // card that led them here
  const theme = String(b?.t || ""), message = String(b?.m || "").trim(), sign = String(b?.f || "").trim();
  if (!/^[a-z]{3,12}$/.test(theme) || !message || message.length > 400 || sign.length > 40) {
    return new Response(JSON.stringify({ error: "invalid card" }), { status: 400 });
  }
  const sb = createClient(import.meta.env.PUBLIC_SUPABASE_URL || "", import.meta.env.SUPABASE_SERVICE_KEY || "");
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 3; i++) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(7)), (x) => abc[x % abc.length]).join("");
    const { error } = await sb.from("greeting_cards").insert({ id, theme, message, sign, from_card: from });
    if (!error) return new Response(JSON.stringify({ id }), { headers: { "content-type": "application/json" } });
    if (error.code !== "23505") break; // not a duplicate id: give up
  }
  return new Response(JSON.stringify({ error: "could not save" }), { status: 500 });
};
