export type BuyerAddressDetail = {
  flat?: string;
  building?: string;
  landmark?: string;
};

export type BuyerAddressRow = {
  id: string;
  buyer_id: string;
  label: string | null;
  flat: string | null;
  building: string | null;
  landmark: string | null;
  location_name: string | null;
  lat: number | null;
  lng: number | null;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
};

export function formatDetailLine(d: BuyerAddressDetail): string | null {
  const parts = [d.flat, d.building, d.landmark]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** True if we have a named area or a map pin (coords are not shown in UI). */
export function hasMapArea(
  location_name: string | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined
): boolean {
  if ((location_name || "").trim()) return true;
  const la = typeof lat === "number" ? lat : NaN;
  const ln = typeof lng === "number" ? lng : NaN;
  return Number.isFinite(la) && Number.isFinite(ln);
}

/** Area label for display only — never appends lat/lng. */
export function formatAreaPart(
  location_name: string | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined
): string | null {
  const name = (location_name || "").trim();
  if (name) return name;
  const la = typeof lat === "number" ? lat : NaN;
  const ln = typeof lng === "number" ? lng : NaN;
  if (Number.isFinite(la) && Number.isFinite(ln)) return null;
  return null;
}

export function composeBuyerAddressString(detailLine: string | null, areaPart: string | null): string | null {
  if (detailLine && areaPart) return `${detailLine} — ${areaPart}`;
  if (detailLine) return detailLine;
  if (areaPart) return areaPart;
  return null;
}

export function formatSavedBuyerAddress(row: BuyerAddressRow): string | null {
  const detail = formatDetailLine({
    flat: row.flat ?? "",
    building: row.building ?? "",
    landmark: row.landmark ?? "",
  });
  const area = formatAreaPart(row.location_name, row.lat, row.lng);
  return composeBuyerAddressString(detail, area);
}

export function hasDeliveryUnitDetail(flat: string, building: string): boolean {
  return !!(flat.trim() || building.trim());
}

export function parseZeptoLocation(): { name?: string; lat?: number; lng?: number } | null {
  try {
    const raw = localStorage.getItem("zepto_location");
    if (!raw) return null;
    return JSON.parse(raw) as { name?: string; lat?: number; lng?: number };
  } catch {
    return null;
  }
}

/** New address from form + current map location (localStorage). */
export function formatNewCheckoutAddress(detail: BuyerAddressDetail): string | null {
  const loc = parseZeptoLocation();
  const detailLine = formatDetailLine(detail);
  const areaPart = loc
    ? formatAreaPart(loc.name ?? null, loc.lat ?? null, loc.lng ?? null)
    : null;
  return composeBuyerAddressString(detailLine, areaPart);
}
