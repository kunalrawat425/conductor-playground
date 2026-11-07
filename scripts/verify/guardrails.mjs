// Guardrails (TESTING.md): fails with file:line for each rule broken. node scripts/verify/guardrails.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const walk = (dir, exts) => readdirSync(join(ROOT, dir)).flatMap((n) => {
  const p = join(dir, n);
  if (n === "node_modules" || n.startsWith(".")) return [];
  return statSync(join(ROOT, p)).isDirectory() ? walk(p, exts) : exts.some((e) => n.endsWith(e)) ? [p] : [];
});
const APP = [...walk("mobile/app", [".tsx", ".ts"]), ...walk("mobile/src", [".tsx", ".ts"])];
// New web UI built in this round (older pages keep their own copy until they're redesigned).
const WEB_NEW = ["src/components/ui/organisms/LoginSheet.astro", "src/components/ui/atoms/OTPInput.astro"];
const DEV_ONLY = /mobile\/src\/ui\/gallery-items\.tsx$/; // dev gallery mirrors the web samples
const code = (l) => !/^\s*(\/\/|\*|\/\*)/.test(l);
// Pictographic emoji; ✓ ✕ ★ ☆ and arrows are typographic and allowed.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{2604}\u{2607}-\u{26FF}\u{2700}-\u{2712}\u{2716}-\u{27BF}\u{2B50}\u{2B06}\u{2B07}\u{FE0F}]/u;
const COLOR = /(?<![\w&])#[0-9A-Fa-f]{3,8}\b|rgba?\(/;
const fails = [];
const each = (files, test, rule) => { for (const f of files) readFileSync(join(ROOT, f), "utf8").split("\n").forEach((l, i) => { if (code(l) && test(l, f)) fails.push(`${rule}: ${f}:${i + 1}: ${l.trim().slice(0, 110)}`); }); };

each([...APP.filter((f) => !DEV_ONLY.test(f)), ...WEB_NEW], (l) => EMOJI.test(l), "no emoji");
each([...APP, ...walk("src", [".ts", ".astro"])], (l) => /Confirm within|Confirm in \d+ ?min|Waiting \d+:\d\d/.test(l), "no deadline/timer copy");
each(APP, (l) => /react-native-webview|<WebView\b/.test(l), "no WebView");
each(APP.filter((f) => !f.includes("/theme/") && !DEV_ONLY.test(f)), (l) => COLOR.test(l), "no hard-coded colours (use mobile/src/theme)");
for (const f of [...APP, ...walk("mobile/modules", [".kt", ".ts"])]) { const n = readFileSync(join(ROOT, f), "utf8").split("\n").length; if (n > 300) fails.push(`file over 300 lines: ${f} (${n})`); }
for (const f of [".env.development.local", "mobile/.env.local", ".context/fcm-service-account.json", ".context/staging.env", ".context/stage-bypass.secret", "mobile/firebase/google-services-buyer.json", "mobile/firebase/google-services-partner.json"]) {
  try { execSync(`git check-ignore -q ${f}`, { cwd: ROOT }); } catch { fails.push(`secret not git-ignored: ${f}`); }
}
if (fails.length) { console.error(fails.join("\n")); console.error(`\n${fails.length} guardrail violation(s)`); process.exit(1); }
console.log("guardrails ok");
