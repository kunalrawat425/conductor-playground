import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { waNumber } from "../../../lib/server/whatsapp";
import { optOutPhone, STOP_WORDS } from "../../../lib/server/wa-optout";

export const prerender = false;
const env = (k: string) => (import.meta.env as any)[k] || process.env[k] || "";

/**
 * POST /api/wati/webhook?key=$WATI_WEBHOOK_KEY: events from Wati (incoming messages, delivery/read,
 * template failures). Wati doesn't sign requests, so the secret key in the URL is the only check.
 * Logs the event type (no message text, no numbers); a "STOP" reply opts the buyer out of offers.
 * Always 200 for a valid key so Wati doesn't retry or mark the webhook defective.
 */
export const POST: APIRoute = async ({ request, url }) => {
  const key = env("WATI_WEBHOOK_KEY");
  if (!key || url.searchParams.get("key") !== key) return new Response("forbidden", { status: 403 });
  const e: any = await request.json().catch(() => ({}));
  console.log(`[wati-webhook] ${e?.eventType || "unknown"}${e?.failedCode ? ` failed=${e.failedCode}` : ""}`);
  const phone = e?.eventType === "message" ? waNumber(e?.waId) : null;
  if (phone && STOP_WORDS.test(String(e?.text || ""))) {
    await optOutPhone(createClient(env("PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_KEY")), phone);
  }
  return new Response("ok", { status: 200 });
};
