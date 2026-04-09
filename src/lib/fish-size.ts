/** Listing size grade shown to buyers (DB column `fish_listings.fish_size`). */
export type FishSize = "small" | "medium" | "large";

const LABELS: Record<FishSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

export function parseFishSize(v: unknown): FishSize | null {
  if (v === "small" || v === "medium" || v === "large") return v;
  return null;
}

export function formatFishSizeLabel(v: string | null | undefined): string {
  const p = parseFishSize(v);
  return p ? LABELS[p] : "";
}

/** Short suffix for compact UI, e.g. " · S" */
export function formatFishSizeSuffix(v: string | null | undefined): string {
  const p = parseFishSize(v);
  if (!p) return "";
  const abbr = p === "small" ? "S" : p === "medium" ? "M" : "L";
  return ` · ${abbr}`;
}
