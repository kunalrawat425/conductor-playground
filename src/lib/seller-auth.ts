/**
 * Seller auth — uses same OTP API routes as buyer, with role=seller.
 * Session stored in localStorage (taazi_seller_id, taazi_seller_phone, taazi_seller_name).
 */

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
    body: JSON.stringify({ phone, code: token, role: "seller" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Invalid OTP");

  // Store seller session in localStorage
  localStorage.setItem("taazi_seller_id", data.seller_id);
  localStorage.setItem("taazi_seller_phone", data.phone);
  localStorage.setItem("taazi_seller_name", data.name || "");

  return data;
}

export function getSession(): { seller_id: string; phone: string; name: string } | null {
  const seller_id = localStorage.getItem("taazi_seller_id");
  const phone = localStorage.getItem("taazi_seller_phone");
  const name = localStorage.getItem("taazi_seller_name") || "";
  if (!seller_id || !phone) return null;
  return { seller_id, phone, name };
}

export function signOut() {
  localStorage.removeItem("taazi_seller_id");
  localStorage.removeItem("taazi_seller_phone");
  localStorage.removeItem("taazi_seller_name");
}
