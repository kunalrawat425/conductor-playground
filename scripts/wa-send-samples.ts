/**
 * Send one real sample of every WhatsApp template to the founder's number only (founder 24 Oct:
 * "send all kinds of messages to me with variables"). Dry-run prints the payloads; --apply sends.
 *   set -a; . .context/whatsapp.env; set +a; npx tsx scripts/wa-send-samples.ts [--apply]
 * Needs the WhatsApp account active and templates APPROVED; unapproved ones are skipped.
 */
import { templatePayload } from "../src/lib/server/whatsapp";
import { TEMPLATES, rotationImage, fishPhoto, SITE } from "../src/lib/messaging/templates";

const TO = "919870619974"; // founder only, never anyone else
const apply = process.argv.includes("--apply");
const { WA_TOKEN = "", WA_PHONE_NUMBER_ID = "", WA_WABA_ID = "" } = process.env;
const CUT_POMFRET = "https://witoghpdfocywiosmrzv.supabase.co/storage/v1/render/image/public/fish-photos/listings/2f39dfce-15c0-4f9a-a5b3-e95280479dbd/fishtokri-site-pomfret.png?width=700&quality=80&resize=contain";

// Journey / user type → template with the variables that customer would get.
const SAMPLES: { label: string; name: string; image?: string; body?: string[] }[] = [
  { label: "New sign-up, weekday", name: "rf_today_check", image: rotationImage(0) },
  { label: "New sign-up, weekend", name: "rf_weekend_menu", image: rotationImage(1) },
  { label: "Shop closed, pre-order", name: "rf_preorder_generic", image: rotationImage(2), body: ["Sun 25 Oct, 9–11 AM"] },
  { label: "Cart, deliver today", name: "rf_cart_today", image: CUT_POMFRET, body: ["Silver Pomfret and Bombil"] },
  { label: "Cart, pre-order", name: "rf_cart_preorder", image: fishPhoto("surmai"), body: ["Surmai", "Sun 25 Oct, 9–11 AM"] },
  { label: "Checkout not paid", name: "rf_retry_order", image: rotationImage(3), body: ["Surmai"] },
  { label: "Paid before (order again)", name: "rf_order_again", image: rotationImage(4), body: ["Pomfret"] },
  { label: "Order paid", name: "rf_order_paid", body: ["#EC034532", "Surmai"] },
  { label: "Order confirmed", name: "rf_order_confirmed", image: fishPhoto("rawas"), body: ["#D39028F2", "Sat 24 Oct, 8–10 AM"] },
  { label: "Out for delivery", name: "rf_order_out", body: ["#D39028F2", "10 AM"] },
  { label: "Delivered", name: "rf_order_delivered", body: ["#D39028F2"] },
  { label: "Cancelled", name: "rf_order_cancelled", body: ["#D39028F2", "fish not available today", "full refund to your original payment method"] },
  { label: "Seller: new paid order", name: "rf_seller_new_order", body: ["#EC034532", "Surmai ½ kg", "Sun 25 Oct, 9–11 AM"] },
  { label: "Seller: still waiting", name: "rf_seller_waiting", body: ["#EC034532"] },
  { label: "Seller: tomorrow's list", name: "rf_seller_tomorrow", body: ["3", "8–10 AM"] },
];

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`https://graph.facebook.com/v26.0/${path}`, { ...init, headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" } });
  return r.json() as any;
};

const status = new Map<string, string>(apply
  ? ((await api(`${WA_WABA_ID}/message_templates?fields=name,status&limit=100`)).data || []).map((t: any) => [t.name, t.status])
  : []);
for (const s of SAMPLES) {
  const t = TEMPLATES.find((x) => x.name === s.name)!;
  const hasUrl = t.buttons.some((b) => b.type === "URL"), hasStop = t.buttons.some((b) => b.type === "QUICK_REPLY");
  const payload = templatePayload({ to: TO, name: s.name, headerImage: t.header === "IMAGE" ? s.image : undefined, body: s.body, urlSuffix: hasUrl ? "sample" : undefined, quickReplyPayload: hasStop ? "STOP" : undefined });
  if (!apply) { console.log(`• ${s.label} → ${s.name}`, JSON.stringify(payload.template.components)); continue; }
  if (status.get(s.name) !== "APPROVED") { console.log(`– ${s.label}: ${s.name} is ${status.get(s.name) || "missing"}, skipped`); continue; }
  const r = await api(`${WA_PHONE_NUMBER_ID}/messages`, { method: "POST", body: JSON.stringify(payload) });
  console.log(r.messages?.[0]?.id ? `✓ ${s.label}: sent` : `✗ ${s.label}: ${JSON.stringify(r.error || r).slice(0, 160)}`);
  await new Promise((ok) => setTimeout(ok, 1500));
}
console.log(`(links open ${SITE}/go/sample → /shop)`);
