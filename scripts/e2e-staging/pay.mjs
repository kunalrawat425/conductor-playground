// Pay an order through the real Razorpay TEST checkout (Netbanking → mock bank).
// usage: node pay.mjs <orderId> <buyerId> <phone> [success|failure]
import { chromium } from "playwright";
import { BASE, login } from "./api.mjs";
const [orderId, buyerId, phone, outcome = "success"] = process.argv.slice(2);
const exe = process.env.HOME + "/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const browser = await chromium.launch({ headless: true, executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await ctx.newPage();
const log = (...a) => console.log("[pay]", ...a);
const t0 = {};
page.on("request", (r) => { if (r.url().includes("/api/payments/")) t0[r.url()] = Date.now(); });
page.on("response", async (r) => {
  if (!r.url().includes("/api/payments/")) return;
  log(r.url().split("/api/payments/")[1], r.status(), `${Date.now() - (t0[r.url()] || Date.now())}ms`, (await r.text().catch(() => "")).slice(0, 160));
});
if (process.env.BLOCK_VERIFY) await page.route("**/api/payments/razorpay-verify", (route) => route.abort());
await page.goto(BASE + "/");
const { json: auth } = await login(phone);
await page.evaluate(([b, p, t]) => { localStorage.setItem("rlf_buyer_id", b); localStorage.setItem("rlf_phone", p); localStorage.setItem("rlf_session_buyer", t); }, [buyerId, phone, auth.session]);
await page.goto(`${BASE}/track/${orderId}`);
await page.getByRole("button", { name: /^Pay/ }).first().click({ timeout: 20000 });
const rz = page.frameLocator('iframe[src*="api.razorpay.com"]');
// Wait for the checkout to finish loading: either the contact step or the methods list.
const mobile = rz.getByRole("textbox", { name: "Mobile number" });
const methods = rz.getByText("Netbanking").first();
await Promise.race([mobile.waitFor({ timeout: 60000 }), methods.waitFor({ timeout: 60000 })]);
if (await mobile.isVisible().catch(() => false)) {
  await mobile.fill("9123456789");
  await rz.getByRole("button", { name: "Continue" }).click();
}
await page.waitForTimeout(3000);
await page.screenshot({ path: "dbg-methods.png" });
if (process.env.CANCEL_AFTER_OPEN) {
  const r = await fetch(BASE + "/api/orders/cancel", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_id: orderId, buyer_id: buyerId, action: "cancel", cancel_reason: "e2e: cancelled with checkout open" }) });
  log("cancelled while checkout open:", r.status, (await r.text()).slice(0, 120));
}
const METHOD = process.env.METHOD || "netbanking";
if (METHOD === "card") {
  await rz.getByText("Cards").first().click({ timeout: 20000 });
  await rz.getByPlaceholder(/card number/i).fill(process.env.CARD || "5267318187975449");
  await rz.getByPlaceholder(/MM ?\/ ?YY|expiry/i).fill("12/30");
  await rz.getByPlaceholder(/cvv/i).fill("123");
  await page.waitForTimeout(1000);
  const go = rz.getByRole("button", { name: /^(Continue|Pay)/ }).last();
  await go.click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const later = rz.getByRole("button", { name: /maybe later|skip/i }).first();
  if (await later.isVisible().catch(() => false)) await later.click();
  // OTP sheet can render in any frame; poll all of them.
  let otpDone = false;
  for (let i = 0; i < 40 && !otpDone; i++) {
    for (const fr of page.frames()) {
      const box = fr.locator('input[placeholder*="OTP" i], input[autocomplete="one-time-code"]').first();
      if (await box.isVisible().catch(() => false)) {
        await box.fill(outcome === "success" ? "123456" : "000000");
        await fr.getByRole("button", { name: /^Continue/ }).last().click();
        otpDone = true; log("otp entered"); break;
      }
    }
    if (!otpDone) await page.waitForTimeout(1000);
  }
} else {
  await rz.getByText("Netbanking").first().click({ timeout: 20000 });
  await rz.getByText("HDFC", { exact: true }).first().click();
}
// Picking a bank can submit straight away; otherwise press the pay/continue button.
await page.waitForTimeout(2500);
if (ctx.pages().length === 1) {
  const go = rz.getByRole("button", { name: /^(Continue|Pay)/ }).last();
  if (await go.isEnabled().catch(() => false)) await go.click({ timeout: 5000 }).catch(() => {});
}
// The mock bank opens as a popup, or inside the checkout frame on some builds.
let bank = null;
for (let i = 0; i < 30 && !bank; i++) {
  await page.waitForTimeout(1000);
  bank = ctx.pages().find((p) => p !== page) || null;
}
await page.screenshot({ path: "dbg-after-pay.png" });
const target = bank || page;
log("bank target:", bank ? bank.url().slice(0, 90) : "same page", "| frames:", page.frames().map(f => f.url().slice(0, 60)).join(" , "));
let clicked = false;
for (const fr of [target, ...target.frames()]) {
  const b = fr.getByRole("button", { name: new RegExp(outcome, "i") }).first();
  if (await b.isVisible().catch(() => false)) { await b.click(); clicked = true; break; }
}
log("clicked", outcome, clicked);
await page.waitForTimeout(12000);
await page.screenshot({ path: `pay-${orderId.slice(0, 8)}-${outcome}.png`, fullPage: true });
const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
log("page after:", text.slice(0, 260));
await browser.close();
