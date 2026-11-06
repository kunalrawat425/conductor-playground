import type { APIRoute } from "astro";
import { festiveTheme } from "../../lib/festive";

export const prerender = false;

/**
 * GET /api/theme → { festive: "diwali" | null }
 * The apps read this at launch so the festive look turns on and off with the site
 * (PUBLIC_FESTIVE_THEME and the date window in src/lib/festive.ts), without a store release.
 */
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ festive: festiveTheme() }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
