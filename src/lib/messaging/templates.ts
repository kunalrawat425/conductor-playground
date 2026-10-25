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
/** v2 marketing footer: no Stop button (founder, 25 Oct); a STOP reply still opts out (whatsapp webhook). */
const RF2_FOOTER = "Reply STOP to stop offers";

export const TEMPLATES: TemplateDef[] = [
  // ── Marketing (opted-in buyers only) ──
  { name: "rf_today_check", category: "MARKETING", header: "IMAGE",
    body: "Today's fish and prices are up 🐟 See what local Thane sellers have on the menu today, pick a 2-hour delivery slot and we'll bring it home, cleaned and cut your way.",
    examples: [], footer: "Team Relifish", buttons: [{ type: "URL", text: "Check today's prices" }, STOP] },
  { name: "rf_weekend_menu", category: "MARKETING", header: "IMAGE",
    body: "Weekend fish, without the market trip 🐟 You signed up with Relifish, so here's this weekend's menu from local Thane sellers. Order now for a 2-hour delivery slot, or pre-order for tomorrow morning. We bring it home cleaned and cut your way.",
    examples: [], footer: "Team Relifish", buttons: [{ type: "URL", text: "Check today's prices" }, STOP] },
  { name: "rf_retry_order", category: "MARKETING", header: "IMAGE",
    body: "Your {{1}} order with Relifish didn't go through last time 🐟 Today's menu from local Thane sellers is up, and checkout takes a few taps: pick your delivery slot and pay online.",
    examples: ["Surmai"], footer: "Team Relifish", buttons: [{ type: "URL", text: "Check today's prices" }, STOP] },
  { name: "rf_order_again", category: "MARKETING", header: "IMAGE",
    body: "Thanks for your {{1}} order with Relifish! Ready for your next fish meal? 🐟 Today's menu from local Thane sellers is up. Order for a 2-hour delivery slot or pre-order for tomorrow morning.",
    examples: ["Pomfret"], footer: "Team Relifish", buttons: [{ type: "URL", text: "Check today's prices" }, STOP] },
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
  // ── v2 (founder, 25 Oct 2026; docs/drafts/WHATSAPP-V2-MESSAGES.md). Seller names, prices and slots
  //    arrive only through variables, filled from the DB at send time. No seller templates (sellers get email).
  // Marketing: opted-in buyers only; promo days Wed 9 AM, Fri 9 AM, Sat 6 PM, one per buyer by stage.
  { name: "rf2_welcome", category: "MARKETING", header: "IMAGE",
    body: "Hi {{1}}, welcome to Relifish! 🐟 You've picked the easy way to buy fish.\nYour fish person, now online: a local seller near {{2}} cleans and cuts it your way and brings it to your door. No market rush.\nNext delivery slot: {{3}}. Have a look at today's catch in the store 🏪\nNot sure what to pick? Just send us a Hi, a real person replies. We've got Thane covered.",
    examples: ["Priya", "Kolshet Road", "today, 2–4 PM"], footer: RF2_FOOTER, buttons: [{ type: "URL", text: "See today's fresh fish" }, { type: "QUICK_REPLY", text: "Help me choose" }] },
  { name: "rf2_welcome_search", category: "MARKETING", header: "IMAGE",
    body: "Hi {{1}}, good to have you on Relifish! 🐟 Today's prices are live in the store, and you see the size and cut before you pay.\nSellers near {{2}} have the morning's catch up now. Next slot: {{3}} 🏪\nWant a price for something you don't see? Send us a Hi, we'll check with the seller for you.",
    examples: ["Rahul", "Manpada", "today, 12–2 PM"], footer: RF2_FOOTER, buttons: [{ type: "URL", text: "See today's prices" }, { type: "QUICK_REPLY", text: "Ask for a price" }] },
  { name: "rf2_cart_today", category: "MARKETING", header: "IMAGE",
    body: "Hi {{1}}, great pick! Your {{2}} from {{3}} is waiting in your cart 🛒\nPlace it now and it can reach you {{4}}, cleaned and cut your way.\nOnce you order, the seller keeps it aside for you. Don't worry, we've got you covered if anything isn't right.\nAny special cut or question? Send us a Hi 👋",
    examples: ["Rahul", "Silver Pomfret", "Fishtokri", "today, 4–6 PM"], footer: RF2_FOOTER, buttons: [{ type: "URL", text: "Get it delivered today" }, { type: "QUICK_REPLY", text: "I have a question" }] },
  { name: "rf2_cart_preorder", category: "MARKETING", header: "IMAGE",
    body: "Hi {{1}}, lovely choice! Your {{2}} from {{3}} is in your cart 🛒\nIt can reach you {{4}}. Pre-order tonight and your share is kept aside for you.\nPay safely online, and if anything isn't right, we've got you covered.\nQuestions? Send us a Hi, we're right here 👋",
    examples: ["Supriya", "Fresh Halwa", "The Nomadic Catch", "Sunday morning, 9–11 AM"], footer: RF2_FOOTER, buttons: [{ type: "URL", text: "Reserve my fish" }, { type: "QUICK_REPLY", text: "I have a question" }] },
  { name: "rf2_promo_cart", category: "MARKETING", header: "IMAGE",
    body: "Happy {{1}}, {{2}}! 🐟 Great pick earlier: your {{3}} from {{4}} is still in your cart 🛒\nToday's catch is in, and the next slot is {{5}}, cleaned and cut your way.\nPlace it now and the seller keeps it aside for you. Questions? Send us a Hi 👋",
    examples: ["Wednesday", "Rahul", "Silver Pomfret", "Fishtokri", "today, 12–2 PM"], footer: RF2_FOOTER, buttons: [{ type: "URL", text: "Get my fish" }, { type: "QUICK_REPLY", text: "I have a question" }] },
  { name: "rf2_promo_unpaid", category: "MARKETING", header: "IMAGE",
    body: "Happy {{1}}, {{2}}! Your {{3}} order is saved with us 🛒\nFinish the payment to confirm it, or pick a new slot if the old one has passed: next slot is {{4}}.\nStuck with the payment? Send us a Hi and we'll sort it out. We've got you covered.",
    examples: ["Friday", "Kavita", "Surmai", "Sunday 9–11 AM"], footer: RF2_FOOTER, buttons: [{ type: "URL", text: "Finish my order" }, { type: "QUICK_REPLY", text: "Payment not working?" }] },
  { name: "rf2_weekend", category: "MARKETING", header: "IMAGE",
    body: "Happy Saturday, {{1}}! 🐟 Sunday fish sorted tonight, without the market rush.\nSellers near {{2}} have the catch up now: {{3}}. Pre-order tonight for {{4}}.\nPick your fish in the store 🏪 and it reaches your door 🛵\nNeed help choosing? Send us a Hi. We've got Thane covered.",
    examples: ["Priya", "Kolshet Road", "Surmai, Pomfret, Rawas", "Sunday 9–11 AM"], footer: RF2_FOOTER, buttons: [{ type: "URL", text: "Pick my weekend fish" }, { type: "QUICK_REPLY", text: "Help me choose" }] },
  { name: "rf2_catch_prices", category: "MARKETING", header: "IMAGE",
    body: "Hi {{1}}, happy {{2}}! Today's fresh catch is in 🐟\n{{3}}\nPrices are fixed by the seller; you see the size and cut before you pay. Order by {{4}} for delivery {{5}}.\nTell us your favourite fish and we'll tell you when it lands. Just send a Hi 👋",
    examples: ["Priya", "Wednesday", "Surmai ₹1,199 · Silver Pomfret ₹1,380 · Bombil ₹313", "4 PM", "today"], footer: RF2_FOOTER, buttons: [{ type: "URL", text: "See all fish & prices" }, { type: "QUICK_REPLY", text: "Tell me my fish lands" }] },
  { name: "rf2_order_again", category: "MARKETING", header: "IMAGE",
    body: "Hi {{1}}, hope the {{2}} was just the way you like it 😊\nReady for another round? {{3}} has fresh stock, same cut as last time. Just pick a slot: {{4}}.\nWant something different this time? Send us a Hi, we'll help 👋",
    examples: ["Sanjay", "Surmai", "The Nomadic Catch", "Sunday 9–11 AM"], footer: RF2_FOOTER, buttons: [{ type: "URL", text: "Order the same again" }, { type: "QUICK_REPLY", text: "Try something new" }] },
  // Utility: about the buyer's own order only.
  { name: "rf2_unpaid", category: "UTILITY", header: "IMAGE",
    body: "Hi {{1}}, your order {{2}} for {{3}} is saved, but the payment hasn't gone through yet.\nTap below to pay and confirm your {{4}} slot 🛒 If the page doesn't open inside Instagram or Facebook, open the link in Chrome or Safari.\nStuck anywhere? Send us a Hi and we'll sort it out with you.",
    examples: ["Kavita", "#35189836", "Surmai", "Sunday 9–11 AM"], buttons: [{ type: "URL", text: "Pay & confirm my slot" }, { type: "QUICK_REPLY", text: "Payment not working?" }] },
  { name: "rf2_paid", category: "UTILITY",
    body: "Payment received for order {{1}}, thank you {{2}}! ✅\n{{3}} will confirm your order within 2 hours, and we'll message you the moment they do.\nAny special request for the cut? Send us a Hi 👋",
    examples: ["#EEB0F7AC", "Manoj", "Fishtokri"], buttons: [{ type: "URL", text: "Track my order" }, { type: "QUICK_REPLY", text: "Add a cut request" }] },
  { name: "rf2_paid_evening", category: "UTILITY",
    body: "Payment received for order {{1}}, thank you {{2}}! ✅ You're all set for {{3}}.\n{{4}} confirms pre-orders first thing in the morning, by 9:30 AM. We'll message you as soon as they do.\nQuestions? Send us a Hi, we're right here 👋",
    examples: ["#588E8380", "Sanjay", "Sunday morning", "The Nomadic Catch"], buttons: [{ type: "URL", text: "Track my order" }, { type: "QUICK_REPLY", text: "Add a cut request" }] },
  { name: "rf2_paid_fast", category: "UTILITY",
    body: "That was quick, {{1}}! ✅ Payment received for order {{2}}.\n{{3}} will confirm it {{4}}, and we'll message you as soon as it's on the way 🛵\nNeed anything? Send us a Hi 👋",
    examples: ["Arvind", "#D39028F2", "Fishtokri", "within 2 hours"], buttons: [{ type: "URL", text: "Track my order" }, { type: "QUICK_REPLY", text: "Add a cut request" }] },
  { name: "rf2_confirmed", category: "UTILITY", header: "IMAGE",
    body: "Confirmed! ✅ {{1}} has accepted your order {{2}}.\nYour fish reaches you {{3}}, cleaned and cut your way.\nWe'll message you when it's on the way 🛵 Questions? Send us a Hi.",
    examples: ["Fishtokri", "#EEB0F7AC", "today, 12–2 PM"], buttons: [{ type: "URL", text: "Track my order" }, { type: "QUICK_REPLY", text: "Chat with us" }] },
  { name: "rf2_out", category: "UTILITY",
    body: "Your fish is on the way 🛵 Order {{1}} should reach you by {{2}}.\nPlease keep your phone close for the delivery person. Anything urgent? Send us a Hi, we've got you covered.",
    examples: ["#EEB0F7AC", "2 PM"], buttons: [{ type: "URL", text: "Track my delivery" }, { type: "QUICK_REPLY", text: "Chat with us" }] },
  { name: "rf2_delivered", category: "UTILITY", header: "IMAGE",
    body: "Delivered! 😊 Hope the {{1}} turns out just the way you like it, {{2}}.\nHow was it, the fish, the cut, the delivery? Two taps to tell us; it helps {{3}} and families near you.\nSomething not right? Send us a Hi and we'll make it right 🙏",
    examples: ["Bombil", "Manoj", "Fishtokri"], buttons: [{ type: "URL", text: "Rate my fish" }, { type: "QUICK_REPLY", text: "Something's not right" }] },
  { name: "rf2_cancelled", category: "UTILITY",
    body: "Sorry, {{1}} 😔 Your order {{2}} couldn't go ahead: {{3}}.\nRefund: {{4}}. We'll keep you posted until it's done.\nWant the same fish from another seller, or a different slot? Send us a Hi and we'll help you right away 🙏",
    examples: ["Rahul", "#A1B2C3D4", "the seller ran out of pomfret today", "₹1,380, started today, reaches your account in 5–7 working days"], buttons: [{ type: "URL", text: "Find the same fish" }, { type: "QUICK_REPLY", text: "Talk to us" }] },
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

/** No-cart offers rotate the fish photo per message (founder 24 Oct: surmai, then pomfret, then crab…). */
const NO_CART_ROTATION = ["surmai", "pomfret", "crab", "prawns", "rawas", "bangda"];
export function rotationImage(sentBefore: number): string {
  return `${SITE}/fish/${NO_CART_ROTATION[Math.max(0, sentBefore) % NO_CART_ROTATION.length]}.jpg`;
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
