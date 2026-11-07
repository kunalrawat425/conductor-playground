// Generates src/theme/tokens.ts from the website's CSS, the one source of truth (DESIGN.md).
//   npm run tokens        (run after any change to ../src/styles/tokens.css or festive.css)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = (f) => readFileSync(resolve(here, "../../src/styles", f), "utf8");
const tokens = css("tokens.css");
const festive = css("festive.css");

/** --v2-name: value pairs inside the first block matching `start`. */
function vars(src, start) {
  const i = src.indexOf(start);
  const body = src.slice(src.indexOf("{", i) + 1, src.indexOf("}", i));
  return Object.fromEntries([...body.matchAll(/--v2-([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const light = vars(tokens, ":root {");
const darkOverrides = vars(tokens, ':root[data-theme="dark"]');
const camel = (k) => k.replace(/-(\w)/g, (_, c) => c.toUpperCase());
const isColor = (v) => /^(#|rgba?\()/.test(v);
const colors = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => isColor(v)).map(([k, v]) => [camel(k), v]));
const px = (v) => Number(String(v).replace("px", ""));

/** First CSS box-shadow → RN shadow props (iOS) + elevation (Android). */
function shadow(v) {
  const m = String(v).match(/(-?\d+)(?:px)?\s+(-?\d+)(?:px)?\s+(\d+)(?:px)?\s+rgba\(([^)]+)\)/);
  if (!m) return {};
  const [r, g, b, a] = m[4].split(",").map((x) => x.trim());
  return { shadowColor: `rgb(${r}, ${g}, ${b})`, shadowOffset: { width: +m[1], height: +m[2] }, shadowRadius: +m[3], shadowOpacity: +a, elevation: Math.max(1, Math.round(+m[3] / 2)) };
}

// Diwali header (festive.css): gradient start/end, gold border and logo colour.
const fh = festive.slice(festive.indexOf(".festive-diwali .v2-header {"));
const grad = fh.match(/linear-gradient\(135deg,\s*(#\w+)[^,]*,\s*(#\w+)/);
const festiveTokens = {
  headerFrom: grad?.[1] ?? "#B3123B", headerTo: grad?.[2] ?? "#8B0A2E",
  headerBorder: fh.match(/border-bottom:\s*\d+px solid (#\w+)/)?.[1] ?? "#D4A24C",
  logo: festive.match(/\.festive-diwali \.v2-header \.v2-logo \{ color: (#\w+)/)?.[1] ?? "#F5D27A",
};
// Dark Diwali header, lights, diya, the "Happy Diwali" ribbon and the gold seller-card border (all in festive.css).
const rule = (sel) => { const i = festive.indexOf(sel); return i < 0 ? "" : festive.slice(i, festive.indexOf("}", i)); };
const hexes = (t) => t.match(/#[0-9A-Fa-f]{6}/g) || [];
const darkHdr = hexes(rule('html[data-theme="dark"] .festive-diwali .v2-header'));
const banner = rule(".fd-banner {"), bannerDark = rule(".fd-banner-dark,");
Object.assign(festiveTokens, {
  headerFromDark: darkHdr[0] ?? "#8B0A2E", headerToDark: darkHdr[1] ?? "#5A0620",
  locSub: rule(".festive-diwali .v2-header .v2-loc-sub").match(/#\w+/)?.[0] ?? "#FDE7B0",
  iconBorder: rule(".festive-diwali .v2-header .v2-icon-btn").match(/rgba\([^)]+\)/)?.[0] ?? "rgba(245, 210, 122, 0.45)",
  wire: rule(".fd-lights::before").match(/rgba\([^)]+\)/)?.[0] ?? "rgba(245, 210, 122, 0.55)",
  bulbs: [rule(".fd-lights i {").match(/color: (#\w+)/)?.[1] ?? "#FFD86B", rule(".fd-lights i:nth-child(3n + 2)").match(/#\w+/)?.[0] ?? "#FFB347", rule(".fd-lights i:nth-child(3n)").match(/#\w+/)?.[0] ?? "#FFF1C1"],
  diyaFrom: hexes(rule(".fd-diya {"))[0] ?? "#E8852E", diyaTo: hexes(rule(".fd-diya {"))[1] ?? "#A8430F",
  rimFrom: hexes(rule(".fd-diya::before"))[0] ?? "#FFC36B", rimTo: hexes(rule(".fd-diya::before"))[1] ?? "#D9741F",
  flame: hexes(rule(".fd-flame::before")).slice(0, 3),
  bannerBorder: banner.match(/border: 1px solid (#\w+)/)?.[1] ?? "#D4A24C",
  bannerBg: hexes(banner.slice(banner.indexOf("background"))).slice(0, 2), bannerInk: banner.match(/\n\s*color: (#\w+)/)?.[1] ?? "#7A0A26",
  bannerBgDark: hexes(bannerDark).slice(0, 2), bannerInkDark: bannerDark.match(/color: (#\w+)/)?.[1] ?? "#FDE7B0",
  bannerBorderDark: bannerDark.match(/border-color: (rgba\([^)]+\))/)?.[1] ?? "rgba(212, 162, 76, 0.7)",
  cardBorder: rule(".festive-diwali .v2-seller-card,").match(/solid (#\w+)/)?.[1] ?? "#D4A24C",
});

// Literal colours the site's components use that are not --v2 tokens (MenuItem pre-order tag, pay-on-delivery pills).
const extras = { purple: "#7C3AED", purpleL: "#F3E8FF", amber: "#B45309", amberL: "#FEF3C7" };

const out = {
  light: { ...colors(light), ...extras },
  dark: { ...colors(light), ...colors(darkOverrides), ...extras, purpleL: "rgba(124, 58, 237, .18)", amberL: "rgba(180, 83, 9, .2)" },
  festive: festiveTokens,
  radius: { xs: px(light["radius-xs"]), sm: px(light["radius-sm"]), base: px(light.radius), lg: px(light["radius-lg"]), xl: px(light["radius-xl"]), full: 9999 },
  space: Object.fromEntries(Object.entries(light).filter(([k]) => /^s-\d+$/.test(k)).map(([k, v]) => [k.slice(2), px(v)])),
  shadow: { sm: shadow(light["shadow-sm"]), base: shadow(light.shadow), md: shadow(light["shadow-md"]), lg: shadow(light["shadow-lg"]) },
  font: { 400: "Inter_400Regular", 500: "Inter_500Medium", 600: "Inter_600SemiBold", 700: "Inter_700Bold", 800: "Inter_800ExtraBold", 900: "Inter_900Black" },
};
writeFileSync(resolve(here, "../src/theme/tokens.ts"),
  `// GENERATED by scripts/gen-tokens.mjs from src/styles/tokens.css + festive.css. Do not edit; run \`npm run tokens\`.\n` +
  `export const tokens = ${JSON.stringify(out, null, 2)} as const;\n`);
console.log(`tokens.ts: ${Object.keys(out.light).length} colours, dark ${Object.keys(colors(darkOverrides)).length} overrides`);
