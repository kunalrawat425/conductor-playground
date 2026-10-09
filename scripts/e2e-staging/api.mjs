// Tiny API driver for the staging preview.
export const BASE = process.env.BASE || "https://stage.relifish.store";
export async function call(path, body, method = body ? "POST" : "GET") {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}
export async function login(phone, role) {
  const s = await call("/api/auth/send-otp", { phone: "+91" + phone });
  const v = await call("/api/auth/verify-otp", { phone: "+91" + phone, code: "123456", ...(role ? { role } : {}) });
  return { send: s.status, ...v };
}
