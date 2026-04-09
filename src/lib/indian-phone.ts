/**
 * Normalize Indian mobile numbers for validation and storage.
 * Accepts optional +91, spaces, dashes, leading 0.
 */
export function normalizeIndianMobile(
  input: string
): { ok: true; digits10: string } | { ok: false; message: string } {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, message: "Enter your mobile number" };
  let d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10) {
    return { ok: false, message: "Use a 10-digit Indian mobile number" };
  }
  if (!/^[6-9]/.test(d)) {
    return { ok: false, message: "Indian mobiles start with 6, 7, 8, or 9" };
  }
  return { ok: true, digits10: d };
}
