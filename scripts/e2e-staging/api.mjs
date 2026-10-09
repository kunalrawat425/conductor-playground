// Tiny API driver for the staging preview.
export const BASE = process.env.BASE || "https://stage.relifish.com";
// Signed sessions from login(); sent on every call like the site's AppShell does.
export const sessions = {};
export async function call(path, body, method = body ? "POST" : "GET") {
  const headers = { "Content-Type": "application/json" };
  if (sessions.buyer) headers["x-rlf-buyer"] = sessions.buyer;
  if (sessions.seller) headers["x-rlf-seller"] = sessions.seller;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}
export async function login(phone, role) {
  const s = await call("/api/auth/send-otp", { phone: "+91" + phone });
  const v = await call("/api/auth/verify-otp", { phone: "+91" + phone, code: "123456", ...(role ? { role } : {}) });
  if (v.json?.session) sessions[role || "buyer"] = v.json.session;
  return { send: s.status, ...v };
}
