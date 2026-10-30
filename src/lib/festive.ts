// Festive theme switch. Diwali 2026 turns itself on 28 Oct and off after 15 Nov (IST);
// PUBLIC_FESTIVE_THEME=diwali forces it on, =off forces it off (previews, screenshots).
// ponytail: prerendered pages (/shop) take the date at build time, so the theme drops off
// there on the first deploy after 15 Nov; SSR pages (home, seller) switch on the day.
export type Festive = "diwali" | null;

export function festiveTheme(now = new Date(), flag = import.meta.env.PUBLIC_FESTIVE_THEME): Festive {
  if (flag === "diwali") return "diwali";
  if (flag === "off") return null;
  const ist = new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  return ist >= "2026-10-28" && ist <= "2026-11-15" ? "diwali" : null;
}

export const FESTIVE = festiveTheme();
