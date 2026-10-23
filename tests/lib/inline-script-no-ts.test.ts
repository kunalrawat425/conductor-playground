import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// <script define:vars> and <script is:inline> are shipped as-is (no TypeScript compile), so a TS
// cast there is a syntax error that kills the whole script (the login sheet broke this way once).
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith(".astro") ? [p] : [];
});
const TS = /\)\s+as\s+[A-Z][\w<>| .]*|\bas\s+(any|unknown|const)\b|\bas\s+HTML\w+/;

describe("inline scripts are plain JavaScript", () => {
  it("no TypeScript casts in define:vars / is:inline scripts", () => {
    const bad: string[] = [];
    for (const f of files("src")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (!/define:vars|is:inline/.test(m[1])) continue;
        m[2].split("\n").forEach((line, i) => { if (TS.test(line) && !/^\s*(\/\/|\*)/.test(line)) bad.push(`${f}: ${line.trim().slice(0, 90)}`); });
      }
    }
    expect(bad).toEqual([]);
  });
});
