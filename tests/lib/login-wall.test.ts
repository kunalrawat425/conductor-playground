import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Founder: the store-page / checkout login can't be dragged or closed; /me, /track and the
 * seller dashboard keep the dismissible sheet. Source-level guard (no .astro renderer in vitest).
 */
const src = (p: string) => readFileSync(resolve(__dirname, "../../src", p), "utf8");

describe("login wall", () => {
  it("store page login sheet is not dismissible; other logins are", () => {
    expect(src("pages/seller/[id].astro")).toMatch(/<LoginSheet id="seller-login-sheet"[^>]*dismissible=\{false\}/);
    for (const p of ["pages/me.astro", "pages/track.astro", "pages/dashboard/login.astro"]) {
      expect(src(p)).toMatch(/<LoginSheet /);
      expect(src(p)).not.toMatch(/dismissible=\{false\}/);
    }
  });

  it("BottomSheet drops handle/✕ and ignores backdrop taps when locked", () => {
    const s = src("components/ui/organisms/BottomSheet.astro");
    expect(s).toMatch(/dismissible = true/);
    expect(s).toMatch(/showHandle && dismissible/);
    expect(s).toMatch(/showClose && dismissible/);
    expect(s).toMatch(/e\.target === bd && !\("sheetLocked" in bd\.dataset\)/);
    expect(src("styles/components.css")).toMatch(/html:has\(\.v2-sheet-backdrop\[data-sheet-locked\]\.v2-sheet-open\)/);
  });

  it("locked LoginSheet adds no history entry and no drag, so Back leaves the page", () => {
    const s = src("components/ui/organisms/LoginSheet.astro");
    expect(s).toMatch(/const panel = dismissible \?/);
    expect(s).toMatch(/if \(dismissible\) try \{ history\.pushState/);
    expect(s).toMatch(/if \(dismissible\) window\.addEventListener\("popstate"/);
  });

  it("on-load wall has no 'dismissed this session' skip and keeps the bot skip", () => {
    const s = src("pages/seller/[id].astro");
    expect(s).not.toMatch(/rf_login_prompt_dismissed/);
    expect(s).toMatch(/bot\|crawl\|spider[^/]*prerender[^/]*\/i\.test\(navigator\.userAgent\)/);
    expect(s).toContain("Log in with your phone to see today's fish");
    expect(s).not.toContain("Log in with your phone to add fish"); // "+" no longer asks; the page-load wall does
  });
});
