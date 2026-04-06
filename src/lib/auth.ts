/**
 * Auth module — uses Twilio Verify via server API routes.
 * Buyer session stored in localStorage (zepto_buyer_id, zepto_phone).
 */

export type { BuyerAddressDetail } from "./buyer-address";

export async function sendOtp(phone: string) {
  const res = await fetch("/api/auth/send-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to send OTP");
  return data;
}

export async function verifyOtp(phone: string, token: string) {
  const res = await fetch("/api/auth/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code: token }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Invalid OTP");

  // Store session in localStorage
  localStorage.setItem("zepto_buyer_id", data.buyer_id);
  localStorage.setItem("zepto_phone", data.phone);

  return data;
}

export function getSession(): { buyer_id: string; phone: string } | null {
  const buyer_id = localStorage.getItem("zepto_buyer_id");
  const phone = localStorage.getItem("zepto_phone");
  if (!buyer_id || !phone) return null;
  return { buyer_id, phone };
}

const ADDRESS_DETAIL_KEY = "zepto_address_detail";

/** Area from LocationPicker (`zepto_location`) — never shows raw coordinates. */
export function getBuyerAddressFromStorage(): string | null {
  try {
    const raw = localStorage.getItem("zepto_location");
    if (!raw) return null;
    const loc = JSON.parse(raw) as { lat?: number; lng?: number; name?: string };
    const name = typeof loc.name === "string" ? loc.name.trim() : "";
    if (name) return name;
    const lat = typeof loc.lat === "number" ? loc.lat : NaN;
    const lng = typeof loc.lng === "number" ? loc.lng : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return "Selected area";
    return null;
  } catch {
    return null;
  }
}

export function getBuyerAddressDetailFromStorage(): BuyerAddressDetail {
  try {
    const raw = localStorage.getItem(ADDRESS_DETAIL_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as BuyerAddressDetail;
  } catch {
    return {};
  }
}

/** Persist flat / building / landmark (reused on future orders on this device). */
export function saveBuyerAddressDetailToStorage(detail: BuyerAddressDetail) {
  const flat = (detail.flat ?? "").trim();
  const building = (detail.building ?? "").trim();
  const landmark = (detail.landmark ?? "").trim();
  if (!flat && !building && !landmark) {
    localStorage.removeItem(ADDRESS_DETAIL_KEY);
    return;
  }
  localStorage.setItem(ADDRESS_DETAIL_KEY, JSON.stringify({ flat, building, landmark }));
}

export function signOut() {
  localStorage.removeItem("zepto_buyer_id");
  localStorage.removeItem("zepto_phone");
}
