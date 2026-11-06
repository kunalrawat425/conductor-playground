// The festive calendar, with no build-env access so the React Native app (mobile/) can share it.
// Diwali 2026 runs 28 Oct–15 Nov (IST); flag "diwali" forces it on, "off" forces it off.
export type Festive = "diwali" | null;

export function festiveFor(now: Date, flag?: string | null): Festive {
  if (flag === "diwali") return "diwali";
  if (flag === "off") return null;
  const ist = new Date(now.getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
  return ist >= "2026-10-28" && ist <= "2026-11-15" ? "diwali" : null;
}
