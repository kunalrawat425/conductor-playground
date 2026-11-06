// Festive theme switch. Diwali 2026 turns itself on 28 Oct and off after 15 Nov (IST);
// PUBLIC_FESTIVE_THEME=diwali forces it on, =off forces it off (previews, screenshots).
// ponytail: prerendered pages (/shop) take the date at build time, so the theme drops off
// there on the first deploy after 15 Nov; SSR pages (home, seller) switch on the day.
import { festiveFor, type Festive } from "./festive-window";
export type { Festive };

export function festiveTheme(now = new Date(), flag = import.meta.env.PUBLIC_FESTIVE_THEME): Festive {
  return festiveFor(now, flag);
}

export const FESTIVE = festiveTheme();
