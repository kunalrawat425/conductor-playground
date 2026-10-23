import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SELLER_PUBLIC_COLUMNS } from "../../src/lib/seller-columns";

const cols = (s: string) => s.split(",").map((c) => c.trim()).filter(Boolean).sort();
const PRIVATE = ["phone", "email", "upi_id", "push_subscription", "auth_id", "first_name", "last_name", "is_admin", "flagged"];

describe("seller columns the public key may read", () => {
  it("leave out contact and login columns", () => {
    for (const c of PRIVATE) expect(cols(SELLER_PUBLIC_COLUMNS)).not.toContain(c);
  });

  it("match the grant in migration 085", () => {
    const sql = readFileSync("supabase/migrations/085_seller_contact_private.sql", "utf8");
    const grant = sql.match(/grant select \(([\s\S]*?)\) on public\.sellers/)![1];
    expect(cols(grant)).toEqual(cols(SELLER_PUBLIC_COLUMNS));
  });

  it("no public page reads every seller column", () => {
    const files = ["src/lib/supabase.ts", "src/pages/shop.astro", "src/pages/area/[city].astro", "src/pages/pricing.md.ts", "src/pages/v1.astro",
      "src/pages/dashboard/profile.astro", "src/pages/dashboard/orders/index.astro"];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/sellers\(\*\)/);
      expect(src, f).not.toMatch(/from\("sellers"\)\s*\.select\("\*"\)/);
    }
  });
});
