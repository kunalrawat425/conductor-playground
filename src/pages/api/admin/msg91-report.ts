import type { APIRoute } from "astro";

export const prerender = false;

const ADMIN_SECRET = import.meta.env.ADMIN_SECRET || "";
const MSG91_AUTH_KEY = import.meta.env.MSG91_AUTH_KEY || "";

/**
 * GET /api/admin/msg91-report?kind=logs|analytics&from=YYYY-MM-DD&to=YYYY-MM-DD   (Authorization: Bearer $ADMIN_SECRET)
 * MSG91's SMS logs or delivery analytics, fetched with the server's key (it's a Vercel "sensitive" env,
 * so it can't be read back; founder 2 Nov). Read-only pass-through; the key never leaves the server.
 */
export const GET: APIRoute = async ({ url, request }) => {
  if (!ADMIN_SECRET || !MSG91_AUTH_KEY) return json({ error: "not configured" }, 503);
  if ((request.headers.get("authorization") || "") !== `Bearer ${ADMIN_SECRET}`) return json({ error: "Unauthorized" }, 401);
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const from = url.searchParams.get("from") || "", to = url.searchParams.get("to") || from;
  if (!day.test(from) || !day.test(to)) return json({ error: "from/to must be YYYY-MM-DD" }, 400);
  const kind = url.searchParams.get("kind") === "analytics" ? "analytics" : "logs";
  const res = await fetch(`https://control.msg91.com/api/v5/report/${kind}/p/sms?startDate=${from}&endDate=${to}`, {
    headers: { authkey: MSG91_AUTH_KEY, accept: "application/json" },
  });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
