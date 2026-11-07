/**
 * Primitives for the web-twin components: Inter text, CSS gradients and shadows written exactly as the site writes them.
 * React Native 0.88 (new architecture) draws CSS `boxShadow` strings and `experimental_backgroundImage` gradients natively.
 */
import { Platform, StyleSheet, Text as RNText, type TextProps, type ViewStyle } from "react-native";
import { useTheme } from "../theme";
import { tokens } from "../theme/tokens";

const WEB_FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'; // --v2-font in src/styles/tokens.css

/** Text in Inter: fontWeight picks the Inter family (one family per weight in RN). No extra Android font padding, like the web. */
export function Text(props: TextProps) {
  const t = useTheme();
  const st = (StyleSheet.flatten(props.style) || {}) as any;
  const w = ({ normal: 400, bold: 700 } as any)[st.fontWeight] ?? (Number(st.fontWeight) || 400);
  const { fontWeight: _w, ...rest } = st;
  const family = (tokens.font as any)[w] ?? tokens.font[400];
  return (
    <RNText
      {...props}
      style={[{ color: t.ink, includeFontPadding: false }, rest, Platform.OS === "web" ? { fontFamily: `${family}, ${WEB_FALLBACK}`, fontWeight: String(w) as any } : { fontFamily: family }]}
    />
  );
}

/** A CSS linear-gradient as the view's background (same string as the site's CSS). */
export const grad = (css: string | null | undefined): ViewStyle => (css ? (Platform.OS === "web" ? ({ backgroundImage: css } as any) : ({ experimental_backgroundImage: css } as any)) : {});
/** A CSS box-shadow (same string as the site's CSS). */
export const shadowCss = (css: string): ViewStyle => ({ boxShadow: css } as any);
/**
 * Chrome's "line-height: normal" for Inter: ascent (0.96875 em) and descent (0.2421875 em) are rounded separately
 * (11 px → 14, 12 → 15, 14 → 17, 16 → 20, 18 → 21, 20 → 24), so text boxes are exactly as tall as on the web.
 */
export const lh = (size: number) => Math.round(size * 0.96875) + Math.round(size * 0.2421875);
export const row = { flexDirection: "row" as const, alignItems: "center" as const };
