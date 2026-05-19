/**
 * Seller auth — uses same OTP API routes as buyer, with role=seller.
 * Session stored in localStorage (rlf_seller_id, rlf_seller_phone, rlf_seller_name).
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
  localStorage.setItem("rlf_seller_id", data.seller_id);
  localStorage.setItem("rlf_seller_phone", data.phone);
  localStorage.setItem("rlf_seller_name", data.name || "");
  localStorage.setItem("rlf_seller_is_active", data.is_active === false ? "0" : "1");

  return data;
}

function migrateSellerStorageKeys() {
  const migrations: [string, string][] = [
    ["zepto_seller_id", "rlf_seller_id"],
    ["zepto_seller_phone", "rlf_seller_phone"],
    ["zepto_seller_name", "rlf_seller_name"],
    ["zepto_seller_is_active", "rlf_seller_is_active"],
  ];
  for (const [old, next] of migrations) {
    const val = localStorage.getItem(old);
    if (val !== null) { localStorage.setItem(next, val); localStorage.removeItem(old); }
  }
}

export function getSession(): { seller_id: string; phone: string; name: string } | null {
  try { migrateSellerStorageKeys(); } catch {}
  const seller_id = localStorage.getItem("rlf_seller_id");
  const phone = localStorage.getItem("rlf_seller_phone");
  const name = localStorage.getItem("rlf_seller_name") || "";
  if (!seller_id || !phone) return null;
  return { seller_id, phone, name };
}

export function signOut() {
  localStorage.removeItem("rlf_seller_id");
  localStorage.removeItem("rlf_seller_phone");
  localStorage.removeItem("rlf_seller_name");
  localStorage.removeItem("rlf_seller_is_active");
}
