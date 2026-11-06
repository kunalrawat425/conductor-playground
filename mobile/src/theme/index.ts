import { useColorScheme } from "react-native";
import { tokens } from "./tokens";
import { festiveFor } from "../../../src/lib/festive-window";

/** The website's colours (generated from src/styles/tokens.css), with the names the screens use. */
function palette(c: typeof tokens.light | typeof tokens.dark) {
  return {
    ...c,
    page: c.bg2,          // body background on the site
    card: c.bg,           // cards, sheets, tab bar
    brandSoft: c.brandL,
    greenSoft: c.greenL,
    redSoft: c.redL,
    amberSoft: c.amberL,
    purpleSoft: c.purpleL,
    onBrand: tokens.light.bg, // text on brand-blue buttons (white in both modes, as on the site)
  };
}
const LIGHT = palette(tokens.light);
const DARK = palette(tokens.dark);
export type Theme = typeof LIGHT;
export const radius = tokens.radius;
export const space = tokens.space;
export const shadow = tokens.shadow;
export const festive = tokens.festive;
/** Diwali header etc. while the site runs its festive theme (src/lib/festive.ts). */
export const isFestive = () => festiveFor(new Date()) === "diwali";

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? DARK : LIGHT;
}
/** Inter at the site's weights: React Native needs one font family per weight. */
export const font = (w: 400 | 500 | 600 | 700 | 800 | 900 = 400) => ({ fontFamily: tokens.font[w] });
export const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
