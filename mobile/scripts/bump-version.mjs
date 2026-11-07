// The app's one version source: mobile/version.json → app.config.ts (version, android.versionCode, ios.buildNumber),
// shown on Account / Profile. Usage: node scripts/bump-version.mjs [patch|minor|major|build]   (build = codes only)
import { readFileSync, writeFileSync } from "node:fs";
const f = new URL("../version.json", import.meta.url);
const v = JSON.parse(readFileSync(f, "utf8"));
const kind = process.argv[2] || "patch";
if (kind !== "build") {
  const [a, b, c] = v.version.split(".").map(Number);
  v.version = kind === "major" ? `${a + 1}.0.0` : kind === "minor" ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}
v.androidVersionCode += 1;
v.iosBuildNumber = String(Number(v.iosBuildNumber) + 1);
writeFileSync(f, JSON.stringify(v, null, 1) + "\n");
console.log(`version ${v.version} · android ${v.androidVersionCode} · ios ${v.iosBuildNumber}`);
