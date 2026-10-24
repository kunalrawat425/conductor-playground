/**
 * The WhatsApp templates Relifish submits to Meta, and how a send fills them. One source for
 * both the submit script (scripts/wa-templates.ts) and the senders, so a send can never drift
 * from what Meta approved. Rules (Meta, Oct 2026): body ≤1024 chars, no variable at the very
 * start or end, button text ≤25, utility templates carry no promotion. Brand rules: no prices,
 * no "freshest/best/guarantee", no seller name in promos.
 */
export const SITE = "https://www.relifish.com";
export const GO_URL = `${SITE}/go/{{1}}`; // /go/<message_id> records the click, then redirects with UTMs
export const PROMO_IMAGE = `${SITE}/wa/relifish-slots.jpg`;
/** New sign-ups (journey A): the "Craving fresh fish?" poster (founder 24 Oct). */
export const SIGNUP_IMAGE = `${SITE}/wa/craving-fresh-fish.jpg`;

type Button = { type: "URL"; text: string } | { type: "QUICK_REPLY"; text: string };
export type TemplateDef = {
  name: string;
  category: "MARKETING" | "UTILITY";
  header?: "IMAGE";
  body: string;
  examples: string[];          // sample values for {{1}}, {{2}}… (Meta requires them)
  footer?: string;
  buttons: Button[];
};

const STOP: Button = { type: "QUICK_REPLY", text: "Stop updates" };

export const TEMPLATES: TemplateDef[] = [
  // ── Marketing (opted-in buyers only) ──
  { name: "rf_today_prices", category: "MARKETING", header: "IMAGE",
    body: "Today's fish prices are out 🐟 {{1}} and more from local Thane sellers. Pick a 2-hour delivery slot and we'll bring it home, cleaned and cut your way.",
    examples: ["Pomfret from ₹430, Prawns from ₹470, Rawas from ₹890"], footer: "Team Relifish", buttons: [{ type: "URL", text: "See today's prices" }, STOP] },
  { name: "rf_preorder_generic", category: "MARKETING", header: "IMAGE",
    body: "Plan your next fish meal 🐟 Pre-order from local Thane sellers and get it on {{1}}, cleaned and cut your way.",
    examples: ["Sun 25 Oct, 9–11 AM"], footer: "Team Relifish", buttons: [{ type: "URL", text: "Pre-order now" }, STOP] },
  { name: "rf_cart_today", category: "MARKETING", header: "IMAGE",
    body: "You left {{1}} in your cart 🐟 It can reach your kitchen today, in the 2-hour slot you pick.",
    examples: ["Baby Rawas"], footer: "Team Relifish", buttons: [{ type: "URL", text: "Finish my order" }, STOP] },
  { name: "rf_cart_preorder", category: "MARKETING", header: "IMAGE",
    body: "You left {{1}} in your cart 🐟 Pre-order now and it reaches your kitchen on {{2}}, cleaned and cut your way.",
    examples: ["Baby Rawas", "Sat 24 Oct, 8–10 AM"], footer: "Team Relifish", buttons: [{ type: "URL", text: "Finish my order" }, STOP] },
  // ── Utility: buyer order updates ──
  { name: "rf_order_paid", category: "UTILITY",
    body: "We received your payment for order {{1}} ({{2}}). The seller will confirm it soon.",
    examples: ["#D39028F2", "Baby Rawas"], buttons: [{ type: "URL", text: "Track order" }] },
  { name: "rf_order_confirmed", category: "UTILITY", header: "IMAGE",
    body: "Your order {{1}} is confirmed for {{2}}. We'll let you know when it's on the way.",
    examples: ["#D39028F2", "Sat 24 Oct, 8–10 AM"], buttons: [{ type: "URL", text: "Track order" }] },
  { name: "rf_order_out", category: "UTILITY",
    body: "Your order {{1}} is on the way and should reach you by {{2}}. Please keep your phone handy.",
    examples: ["#D39028F2", "10 AM"], buttons: [{ type: "URL", text: "Track order" }] },
  { name: "rf_order_delivered", category: "UTILITY",
    body: "Your order {{1}} was delivered. Thank you for ordering with Relifish.",
    examples: ["#D39028F2"], buttons: [{ type: "URL", text: "View order" }] },
  { name: "rf_order_cancelled", category: "UTILITY",
    body: "Your order {{1}} was cancelled ({{2}}). Refund: {{3}}. Reply here if you have any questions.",
    examples: ["#D39028F2", "Fish not available today", "full refund to your original payment method"], buttons: [{ type: "URL", text: "View order" }] },
  // ── Utility: seller ──
  { name: "rf_seller_new_order", category: "UTILITY",
    body: "New paid order {{1}}: {{2}}. Delivery: {{3}}. Please accept it in your dashboard.",
    examples: ["#D39028F2", "Baby Rawas 700–800 g", "Sat 24 Oct, 8–10 AM"], buttons: [{ type: "URL", text: "Accept order" }] },
  { name: "rf_seller_waiting", category: "UTILITY",
    body: "Order {{1}} is still waiting for you. The buyer has paid, please accept or decline it.",
    examples: ["#D39028F2"], buttons: [{ type: "URL", text: "Open order" }] },
  { name: "rf_seller_tomorrow", category: "UTILITY",
    body: "Tomorrow you have {{1}} pre-orders, first delivery {{2}}. Please check them in your dashboard.",
    examples: ["3", "8–10 AM"], buttons: [{ type: "URL", text: "See orders" }] },
];
export const TEMPLATE = Object.fromEntries(TEMPLATES.map((t) => [t.name, t])) as Record<string, TemplateDef>;

/** Problems Meta (or our brand rules) would reject a template for. Empty = OK. */
export function templateProblems(t: TemplateDef): string[] {
  const p: string[] = [];
  const vars = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  if (t.body.length > 1024) p.push("body over 1024 chars");
  if (/^\s*\{\{/.test(t.body) || /\{\{\d+\}\}[\s.!?…)]*$/.test(t.body)) p.push("variable at start or end of body");
  if (vars.some((v, i) => v !== i + 1)) p.push("variables must be {{1}}, {{2}}… in order");
  if (vars.length !== t.examples.length) p.push("one example per variable");
  if (t.buttons.some((b) => b.text.length > 25)) p.push("button text over 25 chars");
  if (t.buttons.filter((b) => b.type === "URL").length > 2) p.push("max 2 URL buttons");
  if (/₹|\brs\.?\s*\d|\bfreshest\b|\bbest\b|\bguarantee|\bno\.?\s*1\b|every rupee back|fishtokri|nomadic/i.test(t.body + (t.footer || ""))) p.push("breaks brand rules (price / superlative / seller name)");
  if (t.category === "UTILITY" && /\b(offer|discount|sale|deal|shop now)\b/i.test(t.body)) p.push("promo wording in a utility template");
  return p;
}

/**
 * The fish's name for a message ("Baby Rawas", "Bombil"). The listing description's first part
 * when it names the fish (Fishtokri: "Baby Rawas · Cut pcs"); otherwise the species, because some
 * sellers start with where it's from ("Sassoon Dock, bought same morning · ...").
 */
export function fishName(description: string | null | undefined, species: string | null | undefined): string {
  const sp = String(species || "").trim().toLowerCase();
  const head = String(description || "").split(" · ")[0].split(",")[0].replace(/^fresh\s+/i, "").trim();
  const stem = sp.replace(/s$/, "");
  if (head && (!stem || head.toLowerCase().includes(stem))) return head.charAt(0).toUpperCase() + head.slice(1);
  return sp ? sp.charAt(0).toUpperCase() + sp.slice(1) : "fish";
}

const PRICE_ORDER = ["pomfret", "surmai", "prawns", "rawas", "bombil", "halwa", "bangda", "ghol", "mandeli", "crab"];
/**
 * "Pomfret from ₹430, Prawns from ₹470, Rawas from ₹890": the lowest pack price of the three most-asked-for
 * fish on today's menu (founder 24 Oct: new buyers should see today's prices). Live listings only.
 */
export function priceLine(listings: { species: string; price: number }[], n = 3): string {
  const low = new Map<string, number>();
  for (const l of listings) if (l.price > 0) low.set(l.species, Math.min(low.get(l.species) ?? Infinity, l.price));
  const rank = (sp: string) => (PRICE_ORDER.indexOf(sp) + 1 || 99);
  return [...low.keys()].sort((a, b) => rank(a) - rank(b)).slice(0, n)
    .map((sp) => `${sp.charAt(0).toUpperCase()}${sp.slice(1)} from ₹${low.get(sp)!.toLocaleString("en-IN")}`).join(", ");
}

/** Fish photo for the "order confirmed" header (public/fish). */
export function fishPhoto(species: string | null | undefined): string {
  const w = String(species || "").toLowerCase();
  const k = ["pomfret", "surmai", "rawas", "prawns", "bangda", "crab"].find((f) => w.includes(f) || (f === "prawns" && w.includes("prawn")));
  return k ? `${SITE}/fish/${k}.jpg` : PROMO_IMAGE;
}

/**
 * Header picture (founder 24 Oct): offers with no cart get the "Craving fresh fish?" poster; cart and
 * order messages show the item they chose (its listing photo, e.g. the cut pomfret), else our photo
 * of that fish, else the poster.
 */
export function headerImage(photo: string | null | undefined, species: string | null | undefined): string {
  if (photo) return photo;
  const own = species ? fishPhoto(species) : PROMO_IMAGE;
  return own !== PROMO_IMAGE ? own : SIGNUP_IMAGE;
}
