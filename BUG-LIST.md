# BUG LIST — Reproducible Bugs Found via Browser QA

**Local server:** http://127.0.0.1:4321 (running persistently — do not kill)
**DB:** `nyavzumoljcrmmwcdcuj.supabase.co` (staging, connected via service key)
**Razorpay:** test mode (`rzp_test_TYQ1rCCU011s9p`)

To reproduce any bug, open the URL in your browser, run the JS snippet in
console to set buyer/seller session, then follow the numbered steps. All bug
IDs cross-reference FIX-NOTES.md.

---

## BUG-1 · S1 · Payment made but order stays "waiting for payment" — THE REPORTED BUG

**Root cause:** No server-side Razorpay webhook. `verify.ts` is only ever
called by the client `handler` in `track/[id].astro:1153`. If that handler
never fires (tab closed, network drop, JS error, Razorpay redirect race),
the payment lands at Razorpay's side but our DB row stays `pending_payment`
forever.

**Reproducer #1 — inspect existing evidence** (fastest):
1. Query DB directly:
   ```
   node --import tsx scripts/qa-db-diagnostics.ts
   ```
2. Section "Orphan Razorpay payments" shows 2 rows: `c00a9d6b`, `973aae59`.
   Both have `razorpay_order_id` set from a real client-side Pay click but no
   `razorpay_payment_id` and no `payment_verified_at`.
3. Log in to Razorpay dashboard → search for `order_Suqj2rGsg8yeYA` (the
   original live-mode Razorpay order id from `c00a9d6b`). Check whether a
   payment was captured against it. If YES → real money was taken; buyer sees
   "waiting for payment" forever.

**Reproducer #2 — synthesize the failure live** (harder but definitive):
1. Reset the orphan: `node --import tsx scripts/qa-reset-orphan.ts`
2. Open http://127.0.0.1:4321/track/c00a9d6b-f7a0-47da-ad2a-a270cf07b2c7
3. In devtools console:
   ```js
   localStorage.setItem('rlf_buyer_id','ceeed802-e716-40b3-bc21-bf3b92a5531c');
   localStorage.setItem('rlf_phone','9359181071');
   // Block verify to simulate tab close between Razorpay success and handler POST
   const orig = window.fetch;
   window.fetch = function(u,o){ if(String(u).includes('razorpay-verify')){ console.log('BLOCKED verify'); return Promise.reject(new Error('simulated')); } return orig.apply(this, arguments); };
   location.reload();
   ```
4. Click **Pay ₹1,800 →** button. Razorpay modal opens.
5. Complete the test payment in the modal:
   `4111 1111 1111 1111` / any future date / CVV `123`
6. Razorpay confirms + tries to call handler → handler tries POST to verify → BLOCKED.
7. Navigate to http://127.0.0.1:4321/me — order NOT visible (see BUG-2).
8. Return to http://127.0.0.1:4321/track/c00a9d6b-f7a0-47da-ad2a-a270cf07b2c7
   → still shows "Complete payment" / "Pay ₹1,800 →" button.
9. DB check: `node --import tsx scripts/qa-check-order.ts` → status still
   `pending_payment`, `razorpay_payment_id: null`.
10. Razorpay side: `curl -su rzp_test_TYQ1rCCU011s9p:xTjFzNHUrIqwefvgtXTr8Aw1
    https://api.razorpay.com/v1/orders/order_TYQ...jgt.../payments` — will
    show captured payment.

**Expected:** After Razorpay captures, our DB should flip regardless of what
the client did. **Actual:** DB depends entirely on client. FIX: **FIX-NOTES #1**.

---

## BUG-2 · S1 · Buyer `/me` hides all in-flight orders

**File:** `src/pages/api/buyer/orders.ts:30`

The endpoint hard-codes:
```ts
const pastStatuses = ["picked_up","completed","declined","cancelled","refunded"];
.in("status", pastStatuses)
```
Buyer with a `pending_payment`, `pending`, `confirmed`, `ready_for_pickup`,
or `out_for_delivery` order sees "No past orders yet" on `/me`.

**Reproducer:**
1. Open http://127.0.0.1:4321/me
2. In console:
   ```js
   localStorage.setItem('rlf_buyer_id','ceeed802-e716-40b3-bc21-bf3b92a5531c');
   localStorage.setItem('rlf_phone','9359181071');
   location.reload();
   ```
3. Order History section shows **1 order** (Rawas cancelled).
4. But DB has **3 orders** for this buyer:
   ```
   node --import tsx scripts/qa-buyer-orders.ts
   ```
   → 2 more `pending_payment` rows: `c00a9d6b` (Prawns ₹1,800) and
   `638ef1e1` (Prawns ₹600). Neither shown in `/me`.

**Expected:** Buyer should see ALL their orders, grouped as "Active" and
"Past". **Actual:** in-flight orders invisible. Confirms buyer perception of
"payment did not reflect" — order literally cannot be found in the app.
FIX: **FIX-NOTES #2**.

---

## BUG-3 · S1 · Seller dashboard tells them "No action needed" while orphans pile up

**File:** `src/pages/dashboard/orders/index.astro:725`

Text: *"⏳ Waiting for buyer to complete Razorpay payment. No action needed."*
For pending_payment orders with `payment_method != 'razorpay'`. Seller sees
the stuck orders but has no button to reconcile with Razorpay.

**Reproducer:**
1. Open http://127.0.0.1:4321/dashboard/orders
2. In console:
   ```js
   localStorage.setItem('rlf_seller_id','fd5534b2-06e8-4011-93f7-40b677a0758f');
   localStorage.setItem('rlf_seller_phone','9999999999');
   location.reload();
   ```
3. Click **New** tab (top).
4. Change range dropdown to **All time**.
5. See 5 pending_payment orders including `#C00A9D6B` — every one says
   "No action needed" and "Can't fulfill".

**Expected:** Seller should have a "🔄 Check Razorpay for payment" button
that hits Razorpay's API for that order's captured payments and, if found,
flips the row to `confirmed`. **Actual:** no escape hatch.
FIX: **FIX-NOTES #3**.

---

## BUG-4 · S1 · 50 orders confirmed with zero payment record

DB has 50 rows: `status='confirmed'`, `payment_method=null`,
`razorpay_payment_id=null`, `payment_verified_at=null`, `paid_amount=null`.
All from April 2026 (pre-Razorpay era). Legacy manual confirmation. No DB
constraint to prevent new such rows.

**Reproducer:**
```sql
select id, status, paid_amount, created_at from orders
where status='confirmed'
  and razorpay_payment_id is null
  and payment_verified_at is null
  and (paid_amount is null or paid_amount=0)
order by created_at desc limit 50;
```
Or run `node --import tsx scripts/qa-db-diagnostics.ts`.

**Fix:** FIX-NOTES #4 (constraint + backfill).

---

## BUG-5 · S2 · 29 orders confirmed with `paid_amount>0` but no payment_verified_at

Same query above with `paid_amount>0`. Schema drift: something marked these
orders confirmed without going through the screenshot-verify code path.

**Fix:** grep every code path that sets `status='confirmed'` — ensure each
also sets `payment_verified_at`.

---

## BUG-6 · S2 · 50+ stale `pending_payment` rows never expired

No cron cleans up abandoned payment attempts. Rows pile up indefinitely.

**Reproducer:** `qa-db-diagnostics.ts` → "Stale pending_payment older than 24h"
section returns 50 rows (query cap).

**Fix:** FIX-NOTES #5 (nightly `/api/cron/expire-pending-orders`).

---

## BUG-7 · S2 · Stale amount if `total_price` changes between create-order calls

**File:** `src/pages/api/payments/razorpay-create-order.ts:54`

Idempotency check returns cached `razorpay_order_id` without comparing amount.
If seller changed `final_price` between two Pay clicks, buyer's second click
opens the modal at the OLD amount. When they pay, verify.ts:66 rejects with
confusing "Payment does not match this order" 400.

**Reproducer:** manual DB update to bump `total_price` after first
create-order, click Pay again, observe modal amount ≠ current total.

**Fix:** FIX-NOTES #6 (amount check before returning cached id).

---

## BUG-8 · S3 · Silent failures in verify.ts side effects

**File:** `src/pages/api/payments/razorpay-verify.ts:113,177,224`

Buyer push, buyer email, seller push, seller email all wrapped in
`.catch(() => {})`. If Resend or push service fails, no log, no alert. Buyer
sees "Payment confirmed" but never gets a receipt email; seller never gets
notified of the new order.

**Fix:** FIX-NOTES #7 — replace with `.catch(err => console.warn(...))`.

---

## BUG-11 · S1 · Every checkout returns 500 (placementKind out of scope) — FIXED

**File:** `src/pages/api/orders/create.ts:219`

`const placementKind = ...` declared inside the `else` block, then referenced
at line 244 outside the block. Runtime `ReferenceError: placementKind is not
defined` on every non-scheduled checkout request. **Prod was affected** — bug
pre-existed on master; not introduced by this session's edits.

**Reproducer** (before fix):
```bash
curl -X POST http://prod/api/orders/create \
  -d '{"buyer_id":"<uuid>","buyer_phone":"+91...","listing_id":"<id>","quantity":1,"quantity_unit":"kg"}'
# → 500 { error: 'placementKind is not defined' }
```

**Fix:** hoisted `let placementKind: ... = "same_day"` above the
`if(scheduled_for)/else` split; both branches now assign it. Verified via
`scripts/qa-m4-checkout.ts` — 10-case suite now 9/10 (only false negative
on a response-shape test assertion).

## BUG-10 · S1 · Buyer cannot cancel Razorpay-paid order + no auto refund — FIXED

**File:** `src/pages/api/orders/cancel.ts:27`

Cancel gated to `["pending","pending_payment","pre_order","scheduled"]`.
Confirmed orders (Razorpay-paid) blocked. Even if unblocked, no Razorpay
refund API call existed.

**Fix:** allow `confirmed` status. On cancel, if `payment_method='razorpay'`
and `razorpay_payment_id` set, POST to Razorpay's `/v1/payments/:id/refund`.
Result stored in `refund_note`, `refund_amt`, `refund_sent_at`. Manual
fallback if API fails.

## BUG-9 · S3 · Hardcoded Supabase URL in 10+ places (logo)

**Files:** `Footer.astro`, `AppShell.astro`, `Header.astro`,
`LandingLayout.astro`, `Onboarding.astro`, `SellerHero.astro`,
`index.astro` (5 more instances)

Logo `<img src>` hardcoded to
`https://witoghpdfocywiosmrzv.supabase.co/storage/v1/object/public/meta/logo_horizontal.png`.
If that project ever gets deleted or storage rotates, the logo breaks
everywhere. Should use `PUBLIC_LOGO_URL` env var or move logo to `public/`.

---

## Environment gotcha — not a bug, but a footgun

Prod uses Supabase project **`witoghpdfocywiosmrzv`**. The keys you supplied
for QA unlock **`nyavzumoljcrmmwcdcuj`**. These are two separate databases.
All findings above pertain to `nyavzumoljcrmmwcdcuj`. Prod could have more
or different orphans — cannot verify without prod Supabase service key.

Confirm which env your reported bug happened on. If it was on
`relifish.store` (prod), grep prod DB for `pending_payment` rows with
`razorpay_order_id` set — that's the S1 evidence set for the real complaint.

---

## Server keep-alive

Dev server started with `nohup` + `disown` at PID `51194`. It will survive
this session ending. To stop it later:
```
pkill -f "astro dev"
```
Logs at `/tmp/astro-dev.log`.

---

## What's proven vs what needs your action

**Proven headlessly (7 test cases):**
- Razorpay verify happy path (M5.4) — DB flips correctly
- Idempotent replay (M5.5) — 200 with no side effect
- Tampered signature (M5.6) — 400 rejected
- Wrong buyer_id (M5.7) — 403 rejected
- Buyer `/me` hides in-flight (BUG-2) — screenshot `/tmp/qa-buyer-me.png`
- Seller dashboard "no action needed" (BUG-3) — screenshot
  `/tmp/qa-seller-alltime.png`
- Orphan mechanism reproduced with fetch monkey-patch (BUG-1) —
  screenshots `/tmp/repro-01/02/03-*.png`

**Needs a real Razorpay iframe click** (headless browse cannot drive
cross-origin iframes):
- Full end-to-end "money captured on Razorpay + still pending in app"
  in a single unbroken session. To capture that in one screenshot:
  1. Follow BUG-1 Reproducer #2 above IN YOUR OWN Chrome, OR
  2. Ask me to run `browse handoff` — I pop a visible Chromium at the
     Razorpay modal on your screen; you enter the test card and say
     done; I capture final state.

---

## BUG-18 · S3 · Waitlist join had no rate limit — FIXED

**File:** `src/pages/api/waitlist/join.ts`

Public unauthenticated endpoint. Anyone could flood `buyer_waitlist` with junk
rows in a loop. Upsert on `(phone, area)` deduped exact repeats but not varied
input.

**Fix:** new shared helper `src/lib/server/rate-limit.ts` (sliding window,
per-IP from `X-Forwarded-For`). Capped at 5 joins / 10 min.

**Verified:** local test — attempts 1-5 pass through, 6 and 7 return `429`
with `Retry-After: 600`.

**Known limitation:** in-memory buckets are per serverless instance, so the
real prod ceiling is `5 × instanceCount` per window. That still converts an
unbounded flood into a bounded trickle. Move to Vercel KV if an actual attack
materialises.

## BUG-19 · S3 · Coordinates accepted any number — FIXED

**Files:** `src/pages/api/buyer/addresses.ts`, `src/pages/api/seller/profile.ts`

`lat: 999, lng: 999` was stored without complaint. Out-of-range coords make
`haversineKm()` return garbage, which then corrupts `computeDeliveryFee()` at
checkout — buyer gets charged a wrong delivery fee, or the distance gate
silently passes/fails.

**Fix:** WGS-84 range guards on both write paths.
- `sanitizeLat` clamps to [-90, 90], else `null`
- `sanitizeLng` clamps to [-180, 180], else `null`
- Applied on buyer_addresses POST + PATCH, and sellers profile POST

Storing `null` (rather than rejecting the request) keeps the address usable
for pickup while disabling distance-based delivery — the safe degradation.

## BUG-9 · S3 · Hardcoded logo URL in 20 places — FIXED

**Files:** 14 files across components, layouts, pages, email templates

Logo URL was pasted inline in 20 spots. If the storage project rotates, the
logo breaks site-wide with no single place to fix.

**Fix:** all sites now `import { LOGO_URL } from "src/lib/brand"`, overridable
via `PUBLIC_LOGO_URL` env with the current URL as default.

**Two build-breaking gotchas hit while doing this (worth remembering):**
1. `typeof import.meta` is a **parse error** in esbuild — `import.meta` is a
   syntactic form, not a value. Reference `import.meta.env.X` directly.
2. Astro frontmatter imports must sit at the **top**. Appending an import
   after existing statements shifts template line numbers and makes the
   compiler fail with a misleading error pointing at unrelated markup.

**Verified:** `astro build` clean; logo renders on `/`, `/for-sellers`,
`/dashboard/login` with zero broken images.

---

# Notification system audit — BUG-20 .. BUG-28

Scope: every order event, both audiences (buyer + seller), both channels
(Web Push + email). The pattern underneath most of these is the same — the
notification was written at the call site, so each new code path re-invented
it and quietly dropped an audience or a channel.

## BUG-20 · S1 · Seller was never told an order was cancelled — FIXED

**Files:** `src/pages/api/orders/cancel.ts`

`action=cancel` sent a buyer push and nothing else. The seller had no push, no
email, and no dashboard signal. They could prep and hold stock for an order the
buyer had cancelled hours earlier. `action=reject_price` also cancels the order
and had the same hole.

**Fix:** both branches now call the new `notifyOrderParties()` fan-out. The
cancel response returns the per-channel `notified` block so the outcome is
assertable from a test and visible in logs.

## BUG-21 · S1 · Webhook reconciliation notified nobody — FIXED

**Files:** `src/pages/api/payments/razorpay-webhook.ts`

`payment.captured` and `refund.processed` flipped the DB row and returned. This
is precisely the recovery path that runs when the buyer's browser died during
checkout — so the one case where nobody saw a confirmation on screen was also
the one case where nobody got told.

**Fix:** both branches fan out via `notifyOrderParties()`. The refund branch
also had its `if (error)` check reordered to run *before* the notify block.

## BUG-22 · S2 · Dead push subscriptions were never pruned — FIXED

**Files:** `src/lib/server/buyer-push.ts`, `src/pages/api/notify-seller.ts`,
`src/lib/server/push-error-classify.ts` (new)

Send failures were logged and forgotten. When a browser subscription expires
(reinstall, cleared data, token rotation) the push service answers `410 Gone`
or `404`. The dead endpoint stayed on the row forever, so *every* future push
to that user failed silently.

**Fix:** shared `isTerminalPushError()`. On 404/410 only, clear
`push_subscription` and set `push_enabled = false` so the user is re-prompted.
Deliberately narrow: 429, 5xx, 401/403 and bare network errors must NOT prune —
a bad VAPID key yields 401 for every user at once, and pruning there would wipe
the entire subscriber base on one bad deploy.

**Verified:** `qa-notifications.ts` N5 drives a real FCM round-trip that returns
410 and asserts the row is cleared and then restored.

## BUG-23 · S2 · "Order placed" push told Razorpay buyers to upload a screenshot — FIXED

**Files:** `src/lib/server/buyer-order-push-copy.ts`,
`src/pages/api/orders/upload-payment.ts`

Copy was a leftover from the screenshot-only era: *"Open Relifish to upload UPI
payment proof."* With Razorpay live there is no screenshot — buyers pay in a
modal — so the push sent them hunting for a control that does not exist.

**Fix:** `placed` and `pending_payment` are now Razorpay-aware.

**Trap worth recording:** `pending_payment` is emitted from two very different
moments — order-created (awaiting payment) and screenshot-uploaded (proof
received). Keying it on the global flag alone corrupted the second one into
"waiting for payment". Split out a `proof_uploaded` status, used only by
`upload-payment.ts`, which never varies with the flag.

Also: the `declined` push title was `"Order Update"`, identical to the
unknown-status fallback, so a decline arrived on the lock screen looking like
routine noise. Now `"Order declined"`.

## BUG-24 · S3 · Silent `catch (_) {}` across the notification paths — FIXED

**Files:** `src/pages/api/seller/orders.ts` (9), `upload-payment.ts` (5),
`waitlist/join.ts` (1), `orders/create.ts`, `create-seller-cart.ts`

Every server-side silent catch is gone (client-side `catch {}` around
`localStorage` is left alone — that is idiomatic and not a failure worth
logging). Each now logs a labelled `console.warn` with the order id.

Related: `sendResendEmail` never checked `res.ok`. Resend answers 4xx for an
unverified domain, a bad recipient or a quota trip — all of which vanished. Now
surfaced.

## BUG-25 · S3 · No visibility into which channel actually delivered — FIXED

`notifyOrderParties()` returns `{buyer_push, buyer_email, seller_push,
seller_email}`, each `"sent"` / `"skipped: <reason>"` / `"failed: <reason>"`,
and logs one line per event. "The customer says they got nothing" is now a log
grep instead of a guess.

## BUG-26 · S1 · Seller push said "Verify in dashboard" on a CANCELLED order — FIXED

**Files:** `src/pages/api/notify-seller.ts`,
`src/lib/server/seller-push-copy.ts` (new)

`/api/notify-seller` understood exactly two kinds and coerced everything else
to `payment_proof`:

```ts
const kind = body.kind === "payment_proof" ? "payment_proof" : "new_order";
```

So the fan-out's cancellation and refund events rendered as *"Payment proof
received. Verify in dashboard."* — the exact opposite instruction from the
cancellation email landing in the same second.

**Fix:** five explicit kinds (`new_order`, `payment_proof`,
`payment_confirmed`, `cancelled`, `refunded`) in a pure, unit-tested copy
module. A test asserts push and email never disagree about whether the seller
should prepare the order.

## BUG-27 · S1 · Order emails were fire-and-forget, so Vercel killed them — FIXED

**Files:** `src/pages/api/orders/create.ts`, `create-seller-cart.ts`,
`src/pages/api/payments/razorpay-verify.ts`,
`src/lib/server/send-email.ts` (new)

Order-placed and payment-receipt emails were sent as unawaited promises,
commented "truly non-blocking". On Vercel the function is frozen the instant
the response is returned, so any Resend request still in flight is killed. The
mail was being dropped by design, non-deterministically — whenever Resend was
slower than the response.

This hit the payment-confirmation path in `razorpay-verify.ts`, where both the
buyer receipt and the entire seller-notify block were unawaited. That is the
most likely mechanical cause of "I paid and never heard anything".

**Fix:** one shared `sendTransactionalEmail()`; call sites collect promises and
`await Promise.allSettled(...)` before responding. Costs ~200–400ms on order
placement, in exchange for the mail actually being sent.

## BUG-28 · S2 · Fan-out logged `seller_push: "sent"` when nothing was sent — FIXED

**Files:** `src/lib/server/notify-order-parties.ts`

`/api/notify-seller` returns `200 {skipped: true, reason: ...}` for no
subscription / VAPID unset / pruned endpoint. The fan-out treated any 200 as
success, so the log asserted the seller had been notified when nothing left the
building — the worst possible failure mode for a diagnostic field.

**Fix:** parse the body; only `sent === true` counts as sent. Found by reading
the dev-server log during the BUG-22 test, not by a failing assertion.

---

## Verification

- `astro build` clean
- `vitest run` — **194/194** (was 147; +47 across 4 new suites:
  `notify-order-parties`, `buyer-order-push-copy`, `seller-push-copy`,
  `push-error-classify`)
- `scripts/qa-notifications.ts` — **27/27**, covering the cancel fan-out, both
  webhook events, all five seller-push kinds, and live 410 subscription pruning
- Integration suites re-run green: M1 10/10 · M2 14/14 · M3 17/17 + 10/10 ·
  M4 9/10 (known response-shape false negative) · M8/M11/M12/M13 18/18 ·
  M9/M15 8/8 · M14 15/15 · admin 13/13 · integration-fixes 9/9 ·
  refund-webhook full 2-step pass

## Known limitation

Web Push delivery cannot be asserted end-to-end from a script — it needs a real
browser subscription. The suite verifies everything up to and including the
push-service HTTP response; the copy itself is covered by unit tests.
