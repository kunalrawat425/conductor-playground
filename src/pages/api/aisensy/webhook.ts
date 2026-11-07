import type { APIRoute } from "astro";

export const prerender = false;
const env = (k: string) => (import.meta.env as any)[k] || process.env[k] || "";

/**
 * POST /api/aisensy/webhook?key=$AISENSY_WEBHOOK_KEY: AiSensy project webhook (needs the Pro plan).
 * The secret key in the URL is the check, as on Wati.
 * ponytail: topic names and payload shape are undocumented, so this only logs the topic and the
 * top-level field names (no values, no numbers). Map delivery status + STOP opt-out once a real event is seen.
 * Always 200 for a valid key so AiSensy doesn't retry.
 */
export const POST: APIRoute = async ({ request, url }) => {
  const key = env("AISENSY_WEBHOOK_KEY");
  if (!key || url.searchParams.get("key") !== key) return new Response("forbidden", { status: 403 });
  const e: any = await request.json().catch(() => ({}));
  const topic = e?.topic ?? e?.event ?? e?.type ?? "unknown";
  console.log(`[aisensy-webhook] ${String(topic).slice(0, 60)} keys=${Object.keys(e?.data ?? e ?? {}).slice(0, 20).join(",")}`);
  return new Response("ok", { status: 200 });
};
