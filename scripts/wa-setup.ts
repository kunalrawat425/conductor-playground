/**
 * WhatsApp Business setup via Meta's API (run after the number is connected).
 *   bun scripts/wa-setup.ts check      → validate templates locally (no network)
 *   bun scripts/wa-setup.ts status     → number status, quality, profile, template states
 *   bun scripts/wa-setup.ts profile    → set the business profile (dry-run unless --apply)
 *   bun scripts/wa-setup.ts templates  → submit missing templates (dry-run unless --apply)
 * Env (from .context/whatsapp.env, never committed): WA_TOKEN, WA_WABA_ID, WA_PHONE_NUMBER_ID, WA_APP_ID.
 */
import { readFileSync } from "node:fs";
import { TEMPLATES, templateProblems, PROMO_IMAGE, SITE } from "../src/lib/messaging/templates";

const GRAPH = "https://graph.facebook.com/v26.0";
const [cmd = "check", flag] = process.argv.slice(2);
const apply = flag === "--apply";
const { WA_TOKEN = "", WA_WABA_ID = "", WA_PHONE_NUMBER_ID = "", WA_APP_ID = "" } = process.env;

export const PROFILE = {
  about: "Fish from local Thane sellers. Order today or pre-order.",
  description: "Relifish is a marketplace for fish from local sellers in Thane. Order today in a 2-hour delivery slot, or pre-order for a later day. Cleaned and cut the way you like. Order at relifish.com/shop",
  address: "Thane West, Maharashtra",
  email: "relifishstore@gmail.com",
  websites: [`${SITE}/shop`, "https://www.instagram.com/relifish_/"],
  vertical: "GROCERY",
};

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${GRAPH}/${path}`, { ...init, headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j as any;
}

/** Upload an image with the Resumable Upload API → header_handle for template creation. */
async function uploadHandle(url: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const s = await api(`${WA_APP_ID}/uploads?file_length=${bytes.length}&file_type=image/jpeg`, { method: "POST" });
  const res = await fetch(`${GRAPH}/${s.id}`, { method: "POST", headers: { Authorization: `OAuth ${WA_TOKEN}`, file_offset: "0" }, body: bytes });
  const j: any = await res.json();
  if (!j?.h) throw new Error(`upload failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j.h;
}

function components(t: (typeof TEMPLATES)[number], handle?: string) {
  const c: any[] = [];
  if (t.header === "IMAGE") c.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [handle || "HANDLE"] } });
  c.push({ type: "BODY", text: t.body, ...(t.examples.length ? { example: { body_text: [t.examples] } } : {}) });
  if (t.footer) c.push({ type: "FOOTER", text: t.footer });
  c.push({ type: "BUTTONS", buttons: t.buttons.map((b) => b.type === "URL"
    ? { type: "URL", text: b.text, url: `${SITE}/go/{{1}}`, example: [`${SITE}/go/7d4f0c1e-0000-4000-8000-000000000000`] }
    : { type: "QUICK_REPLY", text: b.text }) });
  return c;
}

if (cmd === "check") {
  let bad = 0;
  for (const t of TEMPLATES) { const p = templateProblems(t); if (p.length) { bad++; console.log(`✗ ${t.name}: ${p.join("; ")}`); } else console.log(`✓ ${t.name} (${t.category})`); }
  console.log(`profile about ${PROFILE.about.length}/139, description ${PROFILE.description.length}/512`);
  process.exit(bad ? 1 : 0);
}
if (!WA_TOKEN || !WA_WABA_ID || (!WA_PHONE_NUMBER_ID && cmd !== "templates")) { console.error("Set WA_TOKEN, WA_WABA_ID" + (cmd === "templates" ? "" : ", WA_PHONE_NUMBER_ID") + " (source .context/whatsapp.env)"); process.exit(1); }
if (cmd === "status") {
  console.log(await api(`${WA_WABA_ID}/phone_numbers?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,messaging_limit_tier`));
  console.log(await api(`${WA_PHONE_NUMBER_ID}/whatsapp_business_profile?fields=about,address,description,email,websites,vertical,profile_picture_url`));
  const t = await api(`${WA_WABA_ID}/message_templates?fields=name,status,category,rejected_reason&limit=100`);
  for (const x of t.data || []) console.log(`${x.name}: ${x.status} ${x.category} ${x.rejected_reason || ""}`);
} else if (cmd === "profile") {
  console.log(apply ? "Setting profile…" : "Dry run (add --apply):", PROFILE);
  if (apply) console.log(await api(`${WA_PHONE_NUMBER_ID}/whatsapp_business_profile`, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", ...PROFILE }) }));
} else if (cmd === "templates") {
  const existing = new Set(((await api(`${WA_WABA_ID}/message_templates?fields=name&limit=100`)).data || []).map((x: any) => x.name));
  for (const t of TEMPLATES) {
    if (existing.has(t.name)) { console.log(`= ${t.name} already exists`); continue; }
    if (templateProblems(t).length) { console.log(`✗ ${t.name} skipped: ${templateProblems(t)}`); continue; }
    if (!apply) { console.log(`+ would create ${t.name}`, JSON.stringify(components(t)).slice(0, 160)); continue; }
    const handle = t.header === "IMAGE" ? await uploadHandle(t.name === "rf_order_confirmed" ? `${SITE}/fish/rawas.jpg` : `${SITE}/fish/pomfret.jpg`) : undefined;
    console.log(`+ ${t.name}:`, await api(`${WA_WABA_ID}/message_templates`, { method: "POST", body: JSON.stringify({ name: t.name, language: "en", category: t.category, components: components(t, handle) }) }));
  }
}
