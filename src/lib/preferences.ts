/** Buyer preparation preferences chosen at checkout. Untrusted input. */
export const CUT_STYLES = ["whole", "cleaned", "cut"] as const;

export function pickPreferences(cutStyle: unknown, notes: unknown): { cut_style?: string; buyer_notes?: string } | null {
  const cuts = typeof cutStyle === "string"
    ? [...new Set(cutStyle.split(",").map((c) => c.trim()).filter((c) => (CUT_STYLES as readonly string[]).includes(c)))]
    : [];
  const note = typeof notes === "string" ? notes.trim().slice(0, 500) : "";
  const out: { cut_style?: string; buyer_notes?: string } = {};
  if (cuts.length) out.cut_style = cuts.join(",");
  if (note) out.buyer_notes = note;
  return Object.keys(out).length ? out : null;
}
