import type { APIRoute } from "astro";
import { GRAPH } from "../../../lib/server/whatsapp";

export const prerender = false;

const env = (k: string) => (import.meta.env as any)[k] || process.env[k] || "";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const digits = (v: unknown) => (typeof v === "string" && /^\d{5,25}$/.test(v) ? v : "");

/**
 * POST /api/admin/whatsapp-connect   (Authorization: Bearer $ADMIN_SECRET)
 * Body: { code, waba_id, phone_number_id? }  — from Embedded Signup on /admin/whatsapp-connect.
 *       { ping: true } just checks the secret (the page does this before opening Facebook).
 *
 * Coexistence onboarding (Meta docs, "Onboarding WhatsApp Business app users"):
 *   1. GET  /oauth/access_token?client_id&client_secret&code   → business token (code lives 30 s)
 *   2. GET  /{waba_id}/phone_numbers                          → phone_number_id if the event lacked it
 *   3. POST /{waba_id}/subscribed_apps                         → our webhooks for this WABA
 *   4. GET  /{phone_number_id}?fields=is_on_biz_app,platform_type  (expect true / CLOUD_API)
 *   5. POST /{phone_number_id}/smb_app_data {sync_type: smb_app_state_sync} then {sync_type: history}
 * No phone registration (the number is already registered in the app). Each sync runs once per
 * onboarding and must start within 24 h; a repeat returns Meta's error, reported as-is.
 * Returns ids + step results only: the business token is never returned, logged or stored.
 */
export const POST: APIRoute = async ({ request }) => {
  const ADMIN_SECRET = env("ADMIN_SECRET");
  if (!ADMIN_SECRET) return json({ error: "ADMIN_SECRET not configured" }, 503);
  if (request.headers.get("authorization") !== `Bearer ${ADMIN_SECRET}`) return json({ error: "Unauthorized" }, 401);

  let b: any;
  try { b = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const appId = env("WA_APP_ID") || env("PUBLIC_WA_APP_ID") || "1365998548724131";
  const appSecret = env("WA_APP_SECRET");
  if (b?.ping) return json({ ok: true, app_secret_set: !!appSecret });
  if (!appSecret) return json({ error: "WA_APP_SECRET not configured" }, 503);

  const code = typeof b?.code === "string" ? b.code.trim() : "";
  let waba = digits(b?.waba_id);
  if (!code) return json({ error: "code is required" }, 400);

  const graph = async (path: string, token: string, body?: unknown) => {
    try {
      const res = await fetch(`${GRAPH}/${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j: any = await res.json().catch(() => ({}));
      return res.ok ? { ok: true as const, ...j } : { ok: false as const, error: `${res.status} ${j?.error?.message || ""}`.trim().slice(0, 300) };
    } catch (e: any) {
      return { ok: false as const, error: String(e?.message || e).slice(0, 300) };
    }
  };

  // 1. Code → business token.
  const q = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
  const ex = await fetch(`${GRAPH}/oauth/access_token?${q}`).catch(() => null);
  const exText = ex ? await ex.text() : "";
  let token = "";
  try { token = JSON.parse(exText)?.access_token || ""; } catch { token = /^[A-Za-z0-9]+$/.test(exText.trim()) ? exText.trim() : ""; }
  if (!ex?.ok || !token) {
    let msg = ""; try { msg = JSON.parse(exText)?.error?.message || ""; } catch {}
    return json({ error: `code exchange failed: ${ex?.status ?? "network"} ${msg}`.trim(), waba_id: waba }, 502);
  }

  // 1b. No waba_id from the browser (Facebook didn't post the session event): the business token's
  // granular scopes list the WhatsApp accounts it was granted, so read the id from there.
  if (!waba) {
    const dbg = await graph(`debug_token?input_token=${encodeURIComponent(token)}`, `${appId}|${appSecret}`);
    const scopes: any[] = dbg.ok ? dbg.data?.granular_scopes || [] : [];
    const ids: string[] = scopes.find((g) => g.scope === "whatsapp_business_management")?.target_ids || [];
    waba = ids.map(digits).filter(Boolean).pop() || "";
    if (!waba) return json({ error: `waba_id not in the session event or the token's scopes${dbg.ok ? "" : `: ${dbg.error}`}` }, 502);
  }

  // 2. Phone number id (the coexistence finish event carries only waba_id).
  let phoneId = digits(b?.phone_number_id);
  const numbers = await graph(`${waba}/phone_numbers?fields=id,display_phone_number,verified_name`, token);
  const list: any[] = numbers.ok ? numbers.data || [] : [];
  if (!phoneId) phoneId = (list.find((n) => String(n.display_phone_number || "").replace(/\D/g, "").endsWith("9152207607")) || (list.length === 1 ? list[0] : null))?.id || "";

  // 3. Subscribe our app to the WABA's webhooks.
  const subscribe = await graph(`${waba}/subscribed_apps`, token, {});

  const summary: any = {
    waba_id: waba, business_id: digits(b?.business_id) || null, phone_number_id: phoneId || null,
    phone_numbers: list.map((n) => ({ id: n.id, display_phone_number: n.display_phone_number, verified_name: n.verified_name })),
    subscribe_app: subscribe.ok ? "ok" : subscribe.error,
  };
  if (!phoneId) return json({ ...summary, error: numbers.ok ? "no phone number found on this WABA" : `phone_numbers: ${numbers.error}` }, 502);

  // 4. Check it is a coexistence number. 5. One-time syncs: contacts first, then history.
  const status = await graph(`${phoneId}?fields=is_on_biz_app,platform_type,display_phone_number`, token);
  summary.is_on_biz_app = status.ok ? status.is_on_biz_app ?? null : null;
  summary.platform_type = status.ok ? status.platform_type ?? null : status.error;
  for (const sync_type of ["smb_app_state_sync", "history"] as const) {
    const r = await graph(`${phoneId}/smb_app_data`, token, { messaging_product: "whatsapp", sync_type });
    summary[sync_type === "history" ? "history_sync" : "contacts_sync"] = r.ok ? { ok: true, request_id: r.request_id ?? null } : { ok: false, error: r.error };
  }
  return json(summary);
};
