import type { APIRoute } from "astro";
import { timingSafeEqual } from "node:crypto";

export const prerender = false;
const env = (k: string) => (import.meta.env as any)[k] || process.env[k] || "";

/**
 * /dash/* — the founder's dashboard (GA + DB + Meta), served from the private `dash` storage
 * bucket behind a password. Only where DASH_PASSWORD is set (stage); 404 everywhere else.
 * Files are uploaded by .context/reports/dashboard/publish.py, so refreshes need no deploy.
 */
export const GET: APIRoute = async ({ params, request, url, redirect }) => {
  const pass = env("DASH_PASSWORD");
  if (!pass) return new Response("Not found", { status: 404 });
  const given = (() => {
    try { return Buffer.from((request.headers.get("authorization") || "").replace(/^Basic /, ""), "base64").toString().split(":").slice(1).join(":"); }
    catch { return ""; }
  })();
  const a = Buffer.from(given), b = Buffer.from(pass);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("Password required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Relifish dashboard"', "X-Robots-Tag": "noindex" } });
  }
  if (url.pathname === "/dash") return redirect("/dash/", 302);
  const path = String(params.path || "") || "index.html";
  if (!/^[\w./-]+$/.test(path) || path.includes("..")) return new Response("Not found", { status: 404 });
  const key = env("SUPABASE_SERVICE_KEY");
  const res = await fetch(`${env("PUBLIC_SUPABASE_URL")}/storage/v1/object/dash/${path}`, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
  if (!res.ok) return new Response("Not found", { status: 404 });
  return new Response(res.body, { headers: {
    "Content-Type": res.headers.get("content-type") || "application/octet-stream",
    "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow",
  } });
};
