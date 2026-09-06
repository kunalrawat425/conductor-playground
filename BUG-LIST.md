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

---

# Service worker audit — BUG-29 .. BUG-30

Found while answering "can I still rely on push?". Both were live on prod and
affected **every** push notification, buyer and seller alike. Neither could be
caught by an endpoint test — the server sent a perfectly good payload and got a
200 back from the push service; the damage was entirely on the device.

## BUG-29 · S2 · Every push rendered with a blank icon — FIXED

**File:** `public/sw.js:94`

```js
icon: "/icon-192.png",
badge: "/icon-192.png",
```

`public/icon-192.png` did not exist — only `icon-192.svg`, which references a
remote Supabase URL via `<image href>` and would not render in a notification
context anyway. `curl https://relifish.store/icon-192.png` returned **404**.
So every notification we have ever sent showed the browser's generic bell
instead of the Relifish mark, on every device.

**Fix:** generated real `icon-192.png` (192×192, 39 KB), `icon-512.png` and
`badge-96.png` from `favicon.png`. `badge` now points at the 96px asset, which
is what the badge slot actually wants.

Note `favicon.png` is 1254×1254 and **1.4 MB** — usable as a manifest icon but
far too heavy to have been the notification icon, so "just point at favicon"
was not the right fix.

## BUG-30 · S2 · Notification tap could open a 404 — FIXED

**File:** `public/sw.js:66,107`

The push-payload default and `resolvePushTarget`'s fallback were both
`/v2/track`, a route that stopped existing when the `v2` prefix was dropped
(there is no `src/pages/v2/` directory; prod returns **404**).

Any push arriving without a usable `url` — an FCM console message, a payload
whose `url` fails `new URL()`, or any future caller that forgets the field —
sent the user to a dead page from their lock screen.

**Fix:** fallback is now `/me`, which lists the buyer's orders and is the
correct destination for an order notification with no specific target.

## Also

- `manifest.json` declared only `favicon.png` at `sizes: "any"` with
  `purpose: "any maskable"`. Now declares proper 192 and 512 entries for
  install prompts, with `favicon.png` kept as the maskable variant.
- `CACHE_NAME` bumped `relifish-v2` → `relifish-v3` so already-installed
  service workers re-run `install` and pick up the new icons. Without the bump
  existing clients would keep the old cache and never fetch them.
- The icons are added to `SHELL_ASSETS` so notifications still render the mark
  offline. Kept to assets verified to exist, because `cache.addAll()` rejects
  wholesale if any single entry 404s — which would have broken shell caching
  entirely had the missing icon been listed there originally.

---

# Cron + status-machine audit — BUG-31 .. BUG-35

Found by asking "which code paths change an order's state?" rather than "which
endpoints return 200?". The crons and the preorder accept path were never
covered because they are not reachable from a module test — one runs on a
schedule, the other returned a success body while doing nothing.

## BUG-34 · S1 · `payment_verified_by` is a uuid column; three writers put strings in it — FIXED

**Root cause for BUG-34 and BUG-35 both.** `orders.payment_verified_by` is
`uuid`. Proven directly against the DB:

```
write non-UUID string to payment_verified_by -> 22P02: invalid input syntax for type uuid: "cron_reconcile"
```

Three writers passed a label instead of a UUID, so Postgres rejected the
**entire UPDATE**. In every case the returned `error` was discarded, so the
failure was completely invisible:

| File | Value written | Consequence |
|---|---|---|
| `api/cron/reconcile-orphans.ts:69` | `"cron_reconcile"` | cron reported `flipped=0` forever — **had never once recovered an order** |
| `api/admin/reconcile-all-orphans.ts:87` | `"admin_reconcile"` | bulk reconcile never flipped anything |
| `api/orders/cancel.ts:121` | `"buyer_accept_price"` | see BUG-35 |

The reconcile cron is supposed to be the last line of defence for a captured
payment whose webhook was missed. It was dead on arrival.

**Fix:** column stays `null` (matching the precedent set when the legacy
backfill hit the same 22P02); `payment_verified_at` alone satisfies the BUG-5
invariant, and the actor is recorded in the log line. Every one of these
updates now checks `error` and reports it.

## BUG-35 · S1 · "Accept price" returned success and did nothing — FIXED

**File:** `src/pages/api/orders/cancel.ts:121`

Reproduced end to end against the dev server:

```
seeded pre_order: bdaaf710… final_price: 250
accept_price HTTP: 200 {"success":true,"status":"confirmed"}
DB status after accept: pre_order | verified_at: null
=> BROKEN
```

The buyer taps **Accept price** on a preorder, the UI reports success, and the
order never leaves `pre_order`. Reload and they are asked to accept the same
price again, forever. Money path, and a lying 200 — the same failure shape as
the notification bugs.

After the fix, same script: `DB status after accept: confirmed` → `WORKS`.
Locked in as `qa-notifications.ts` N6, which asserts the **database row**
rather than the response body, plus N6-T4 which guards the column type so a
future string write fails loudly in CI.

## BUG-31 · S1 · Expiry cron cancelled orders and told nobody — FIXED

**File:** `src/pages/api/cron/expire-pending-orders.ts`

The nightly job flips unpaid orders to `cancelled` and returned. No push, no
email, to either party. From the buyer's side the order simply **vanished** —
precisely the "my order disappeared" complaint that started this whole audit.
The seller was never told either, so a catch held back for that order was
never released.

**Fix:** fans out a new `expired_unpaid` event. The copy states explicitly that
nothing was charged, because a bare "cancelled" notification reads like money
disappeared.

**Verified:** `{"ok":true,"expired":1,"stock_restored":0,"notified":1}`

## BUG-32 · S1 · Orphan-recovery cron notified nobody — FIXED

**File:** `src/pages/api/cron/reconcile-orphans.ts`

Same silence, in the worst possible place. This cron runs when the buyer paid,
the client handler dropped, **and** the webhook missed it. It confirms the
order from Razorpay's own record — and then told no one. The single case where
the buyer has the least reason to believe their payment worked was the case
with zero communication.

**Fix:** fans out `payment_confirmed` on every successful flip. (Note this only
became reachable at all once BUG-34 was fixed — the flip itself had never
succeeded.)

## BUG-33 · S1 · Expiry cron leaked inventory — FIXED

**File:** `src/pages/api/cron/expire-pending-orders.ts`

`/api/orders/cancel` calls `restore_order_stock` when `inventory_deducted ===
true`. The cron cancelling the *same* orders did not. Any `pending` row that
had already deducted stock lost it permanently: the listing stayed short and
the seller could never sell that quantity again. Silent, cumulative, and
invisible — the stock count just drifts down over time.

**Fix:** mirrors the cancel endpoint exactly, same `inventory_deducted === true`
guard, and reports `stock_restored` in the response.

---

## Verification

- `astro build` clean · `vitest run` **194/194**
- `qa-notifications.ts` **31/31** (was 27; +4 for the uuid-column regression)
- Both crons exercised via GET + Bearer, as Vercel Cron actually invokes them:
  `expire-pending` → `expired:1, notified:1`; `reconcile-orphans` →
  `scanned:2, skipped:2, errors:0`
- Auth still enforced: 401 without Bearer on both
- Module suites re-run green: M4 9/10 (known false negative) ·
  integration-fixes 9/9 · M9/M15 8/8 · admin 13/13 · M8/M11/M12/M13 18/18

## Method note

Every bug in this batch returned HTTP 200 (or ran silently on a schedule) while
doing nothing. Endpoint status-code tests cannot find these. What found them was
checking the **database row after the call**, and grepping for discarded
`error` values on Supabase writes. Worth repeating on any remaining path that
mutates orders.

---

# BUG-36 .. BUG-38 · auth race, money-path silence, phantom stock

## BUG-38 · S1 · Every cancellation invented phantom stock — CODE FIXED, MIGRATION PENDING

**Files:** `supabase/migrations/029_inventory_preorder_confirm_only.sql`
(`restore_listing_inventory`), `src/pages/api/orders/cancel.ts`,
`src/pages/api/cron/expire-pending-orders.ts`

`restore_listing_inventory()` is an AFTER UPDATE trigger whose body runs
`update orders set inventory_deducted = false where id = NEW.id`. That nested
UPDATE **re-fires the same trigger**, and at that moment `OLD.inventory_deducted`
is still true and `NEW.status` is still `cancelled`, so the guard passes and the
quantity is added a second time. Measured on staging, 2 kg order:

```
insert (deduct)     -> 25.5
status -> cancelled -> 29.5      +4 restored for a 2 kg order
```

`/api/orders/cancel` then called `restore_order_stock` on top of that, making it
**three** restores — measured +6 for a 2 kg order. Every cancel, decline or
refund handed the seller free inventory they never had, so they oversell.

**This invalidates BUG-33.** My earlier "fix" added a restore call to
`expire-pending-orders.ts` on the belief that stock was being leaked. The
opposite was true — it was being over-restored, and I made it worse. That call
is reverted, and both redundant calls in `cancel.ts` are removed. Endpoint
drift is now +4 instead of +6.

**Remaining half needs a migration** (`065_fix_double_stock_restore.sql`) —
PostgREST cannot execute DDL, so this must be run by hand:

```sql
create trigger trg_restore_inventory
  after update on orders
  for each row
  when (OLD.status is distinct from NEW.status)   -- nested UPDATE no longer re-fires
  execute function restore_listing_inventory();
```

The migration also adds `and OLD.status not in ('cancelled','declined','refunded')`
as defence in depth, and stops the trigger force-setting `is_available = true`
unconditionally — that was re-listing items a seller had deliberately marked
sold out.

Until it is applied, cancellations still over-restore by 1× the order quantity.

## BUG-36 · S1 · OTP attempt limit defeated by concurrency — FIXED

**File:** `src/pages/api/auth/verify-otp.ts`

The wrong-code branch did `update({ verify_attempts: row.verify_attempts + 1 })`
using a value from an earlier SELECT — a read-modify-write on a stale read, with
the error discarded. Concurrent guesses all read the same number and write the
same increment. Measured:

```
20 concurrent wrong guesses -> verify_attempts went 0 -> 1
=> LIMIT DEFEATED (expected 20)
```

`MAX_VERIFY_ATTEMPTS = 3` was therefore not a limit at all. Fired in parallel
batches, a 6-digit OTP is brute-forceable.

**Fix:** compare-and-swap — the UPDATE carries `.eq("verify_attempts", expected)`
so exactly one racer wins per round; losers re-read and retry, which re-applies
the limit check. No migration needed. If the attempt cannot be recorded the
request now **fails closed** with 503, because handing out a guess we cannot
count is exactly what made brute force viable.

## BUG-37 · S2 · Failed OTP burn was silent — FIXED

Same file. The post-success burn discarded its error, so a failed burn left the
code replayable until natural expiry with nothing logged. Replay still requires
knowing the code, so this is hygiene rather than a gate — it now logs at
`console.error` rather than failing a login the user already earned.

## Money-path writes that could fail silently — FIXED

`src/pages/api/orders/cancel.ts` discarded the error on its main status UPDATE.
The Razorpay refund is issued **before** that write, so a failure meant the
buyer got their money back while the order stayed `confirmed` — the seller
prepares and hands over food that has already been refunded, and the response
still said `{"success":true}`. It now returns 500 and names the refund id so
support can trace it.

A sweep found **26** awaited Supabase mutations whose result was discarded
entirely. The ones on order, money and auth paths are fixed; the remainder are
flag updates (`push_enabled` self-heal, `email_sent`) where a silent failure is
genuinely harmless.

## BUG-39 · S1 · Guest orders had NO authorization on /api/orders/detail — FIXED

**File:** `src/pages/api/orders/detail.ts:50`

```ts
if (order.buyer_id && order.buyer_id !== buyer_id) { /* phone fallback check */ }
```

`/api/orders/create` inserts `buyer_id: buyer_id || null`, so a guest order has
`buyer_id = NULL`. The `&&` then short-circuits and **no authorization runs at
all** — any caller holding the order UUID receives the full `select("*")`:
`buyer_phone`, `buyer_notes`, the resolved delivery address, the seller's phone,
and `upi_id` when Razorpay is disabled.

Proven against staging:

```
guest order: 18ea5812-…
HTTP 200
LEAKED buyer_phone: 9876500099
LEAKED buyer_notes: SECRET: ring the back doorbell
=> LEAK CONFIRMED: unrelated buyer_id read a guest order
```

**Fix:** dropped the `order.buyer_id &&` guard so a NULL falls through to the
phone comparison — which is what the sibling endpoints (`update-notes`,
`payment-screenshots`) already do. Also requires `order.buyer_phone` to be
non-empty, so two rows with NULL phone cannot match each other.

After: same request returns **403**, while an owner reading their own order and
a buyer claiming a guest order by matching phone both still return 200.
Locked in as `qa-notifications.ts` N7 (all three cases).

---

# BUG-40 .. BUG-41 · money path

## BUG-40 · S1 · Delivery fee charged once per cart LINE — FIXED

**File:** `src/pages/api/orders/create-seller-cart.ts:245`

```ts
const delivery_fee = seller ? computeDeliveryFee(seller, line.total_price, ...) : 0;
```

This sat inside the per-line loop. A cart becomes one order row per line and
each row is paid separately, so a 3-line cart was charged the delivery fee three
times. `computeDeliveryFee`'s second parameter is literally named `subtotal` —
it always wanted the cart total. `cartSubtotal` was already computed on line 95
and used for the minimum-order check, but never for the fee.

The `free_delivery_above` case is worse, because the client and server disagree:
`seller/[id].astro` compares the whole subtotal against the threshold and can
display **"FREE"**, while the server compared each line individually and charged
the fee on every one. The buyer pays a delivery charge the UI promised was free.

Real row on staging — buyer `9870619974`, 2026-04-14T20:37:

```
2 order rows, delivery_fee = [50, 50] → ₹100 charged for one delivery
```

**Fix:** the fee is computed once from `cartSubtotal` before the loop and
carried by the first row only; the rest get 0.

**Verified** by `scripts/qa-delivery-fee.ts` (6/6), which mutates a staging
seller's fee config and restores it afterwards:

```
A. Flat ₹30 fee, 2-line cart      rows=2 fees=[30, 0] total=₹30
B. free_delivery_above cleared     subtotal=₹930 fees=[0, 0] total=₹0
C. Pickup cart                     total=₹0
```

## BUG-41 · S1 · Re-paying an order could orphan already-captured money — FIXED

**File:** `src/pages/api/payments/razorpay-create-order.ts:87`

When the cached Razorpay order's amount no longer matched the order total (the
BUG-6 stale-amount fix), the code did:

```ts
await supabase.from("orders").update({ razorpay_order_id: null }).eq("id", order_id);
```

without first asking whether that Razorpay order had already been **paid**.
`razorpay_order_id` is the only key every recovery path uses:

- `razorpay-webhook.ts` matches `.eq("razorpay_order_id", ...)`
- `cron/reconcile-orphans.ts` filters `.not("razorpay_order_id","is",null)`
- `seller/reconcile-razorpay.ts` reads the stored id

Failure sequence: seller changes `final_price` → buyer taps Pay again → the id
is nulled and a new Razorpay order created → but the buyer had already paid the
first one and the client-side verify POST died. Now the original
`payment.captured` webhook matches **zero rows**, the orphan cron cannot see the
row (its id is null), the seller's "Check Razorpay" button queries the new
order, and 24 h later `expire-pending-orders` — which selects
`.is("razorpay_order_id", null)` — cancels it as `auto_expired_payment`.
**Money captured, order cancelled, nobody refunds.**

**Fix:** read `amount_paid` on the cached order first.
- `amount_paid > 0` → do **not** clear. List the order's payments, reconcile the
  row to `confirmed` at the captured amount, fan out `payment_confirmed`, and
  return **409 `already_paid`** so the client cannot open a second checkout
  against an order that has been paid.
- Razorpay unreachable → keep the id and return 502, rather than risk orphaning
  on a network blip.
- Only clear once Razorpay has confirmed it holds no money for that order.

### Related: the webhook's false all-clear

`razorpay-webhook.ts` logged this for *every* zero-match:

```
no pending row for {id} (already confirmed — OK)
```

Zero matches also means **no order carries that id at all** — exactly the
orphaned-money case above — so the one log line that should have screamed read
"OK". It now distinguishes the two and logs
`ORPHANED PAYMENT: no order carries razorpay_order_id … Manual reconcile required.`
at `console.error`.

**Verified:** a signed `payment.captured` for an unknown order id now produces
that error line instead of an all-clear.

## BUG-42 · S1 · Sellers were told to refund orders nobody ever paid for — FIXED

**Files:** `src/lib/order-payment-state.ts` (new),
`src/pages/dashboard/orders/index.astro:818,924`,
`src/pages/track/[id].astro:261,262,304,491`

`create_order_atomic` sets `paid_amount = total_price + delivery_fee` at INSERT
time — it records what the buyer **owes**, not what they **paid**. Four readers
tested only `paid_amount > 0`, so every unpaid order looked paid.

Consequence: a buyer places a ₹1,800 order, never pays, `expire-pending-orders`
cancels it — and the seller's History card renders
**"↩ Refund ₹1,800 to buyer via UPI · Buyer expects refund within 7 working
days"** with a *Mark refund sent* button, while the buyer's track page shows
**"Refund pending"** and a refund stepper. For money that never moved.

`track/[id].astro:425` already knew about this (*"paid_amount is pre-set at
creation"*) and guarded on `payment_verified_at` — the other four sites simply
never applied it.

**Fix:** one shared `wasActuallyPaid()` / `refundableAmount()` in
`src/lib/order-payment-state.ts`, imported by both pages so the dashboard and
the track page cannot drift apart again.

Evidence that money moved is any of `razorpay_payment_id`,
`payment_verified_at`, or **a payment screenshot**. That last one is included
deliberately: a screenshot is only a *claim*, but the buyer may genuinely have
sent UPI money and the seller must see the prompt to check the proof and decide.
Showing a prompt the seller can dismiss is far safer than silently hiding a
refund a buyer is owed — my first version omitted it and would have hidden two
real refunds.

**Measured across all 163 cancelled/declined rows on staging:**

```
OLD refund prompts: 127
NEW refund prompts: 2
phantom removed:    125
  kept c4ab9c61 ₹270  verified=false rzp=false shots=1
  kept 9a86792f ₹1400 verified=false rzp=false shots=1
```

Both kept rows are exactly the UPI-screenshot case. Covered by 14 unit tests in
`tests/lib/order-payment-state.test.ts`.

**Note on the underlying schema:** the real repair is to stop pre-setting
`paid_amount` at creation and set it from the captured amount in
`razorpay-verify` / `razorpay-webhook` / `verify_payment`. That is a migration
plus a backfill of existing rows, so this change fixes the readers first — no
row is mutated, and the display is now correct regardless.

## BUG-43 · S1 · A cheaper pre-order catch restored stock on a live order — CODE FIXED, MIGRATION PENDING

**Files:** `supabase/migrations/043_preorder_price_reconciliation.sql`
(`reconcile_preorder_price`), `src/pages/api/seller/orders.ts:283`,
`src/pages/dashboard/orders/index.astro`, `src/pages/track/[id].astro`

```sql
elsif p_final_price < v_paid then
  v_new_status := 'refunded';   -- seller owes buyer the difference
```

`refunded` is one of the statuses `trg_restore_inventory` treats as terminal, so
setting it returned the stock and set `inventory_deducted = false` /
`is_available = true` — **while the order carried on being fulfilled**.
`seller/orders.ts:283` explicitly allows `refunded → ready_for_pickup |
out_for_delivery`, and the dashboard renders those buttons in the `refunded`
branch. So the seller got the fish back into sellable inventory *and* handed it
to the buyer. The next sale had no stock behind it and nothing re-deducted.

Not an edge case: `paid_amount` is pre-set to the estimate at creation (see
BUG-42), so **any** catch that priced in cheaper than estimated took this path.

**Fix — stop overloading `refunded`.** The order *is* confirmed; there is simply
a difference owed. `reconcile_preorder_price` now returns `confirmed` and
records the difference in `refund_amt` (already used with exactly that meaning
by `orders/cancel.ts` and the Razorpay webhook). `refunded` goes back to meaning
only "money went back and the order is over".

Because the obligation moved out of the status, it had to be surfaced or it
would vanish silently:
- **Seller** — the `confirmed` branch now shows *"↩ Refund ₹X to buyer · Final
  price came in lower than they paid. Fulfil the order as normal, then send the
  difference."* with a *Mark refund sent* button.
- **Buyer** — the payment pill reads *"Paid · ₹X refund due"*.

`refunded: ["ready_for_pickup", "out_for_delivery"]` is deliberately **kept** in
the transition whitelist: rows created before this fix are already sitting in
`refunded` mid-fulfilment and must stay fulfillable.

**Needs `066_preorder_price_drop_keeps_order_live.sql` applied by hand** — until
then, a price drop still flips to `refunded` and still restores stock once.

---

## Test-suite note

`scripts/qa-delivery-fee.ts` first reported `0/0 PASS` on a later run because it
picked a different staging seller that was closed that day — the fee logic was
fine, the fixture wasn't. It now forces the chosen seller open for the whole run
(`open_days: []`, `00:00–23:59`, `has_pickup: true`), restores every mutated
field afterwards, and **fails when zero assertions ran** instead of reporting a
green `0/0`. A suite that can silently assert nothing is worse than no suite.

## BUG-44 · S1 · Seller declining a Razorpay-paid order refunded nothing — FIXED

**Files:** `src/lib/server/razorpay-refund.ts` (new),
`src/pages/api/seller/orders.ts`, `src/pages/api/orders/cancel.ts`

The seller-initiated decline/cancel branch wrote `cancelled_by` and
`refund_note` and stopped. No Razorpay refund call, no `refund_amt`, no
`refund_sent_at`. The buyer-initiated path in `orders/cancel.ts` had always
called `POST /v1/payments/:id/refund` — the seller path simply never did.

The dashboard button is labelled **"✓ Confirm — refund buyer"** and the
resulting card tells the seller to send the money over UPI. But for a Razorpay
order the funds are in the **platform's** Razorpay account, not the seller's, so
following that instruction is impossible and the buyer got nothing unless
someone noticed and refunded by hand.

**Fix:** the refund logic is extracted to `refundRazorpayPayment()` and called
from both paths, so they cannot drift again. On success the seller branch also
stamps `refund_amt` and `refund_sent_at`; on failure it records why, e.g.
`Razorpay refund FAILED (404): … — seller must refund manually`.

**Found while wiring it:** the `currentOrder` select in `seller/orders.ts` did
not include `razorpay_payment_id`, so the new check would have silently been
false for every order. Added to the select.

**Verified** against a confirmed Razorpay order with a deliberately invalid
payment id:

```
decline HTTP: 200
status: declined
refund_note: Razorpay refund FAILED (404): unknown — seller must refund manually
=> refund WAS attempted and recorded
```

Previously nothing was attempted and nothing was recorded.

## BUG-45 · S2 · Per-buyer daily quantity cap reset at 05:30 IST — FIXED

**Files:** `src/lib/server/resolve-listing-order-line.ts:191`,
`src/lib/order-timing.ts`

```ts
const todayStart = new Date();
todayStart.setHours(0, 0, 0, 0);
```

`setHours` zeroes the time in the **server's** zone. On Vercel that is UTC, so
the window ran 05:30 IST → 05:30 IST. A listing capped at 5 kg per buyer per day
allowed 5 kg at 02:00 IST and another 5 kg at 06:00 IST — **10 kg inside one IST
day**. Everything else in this codebase converts explicitly;
`order-timing.ts:20` even documents the exact hazard for `todayDayName`.

**Fix:** new `istDayStartISO()` in `order-timing.ts`, alongside the existing IST
helpers, used for the cap window. Covered by 5 unit tests including the precise
02:00/06:00 IST case that defeated the cap, and the 18:29/18:31 UTC pair that
must straddle the IST midnight rollover.
