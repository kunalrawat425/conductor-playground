/**
 * Auth module — uses Twilio Verify via server API routes.
 * Buyer session stored in localStorage (zepto_buyer_id, zepto_phone).
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

export function signOut() {
  localStorage.removeItem("zepto_buyer_id");
  localStorage.removeItem("zepto_phone");
}
