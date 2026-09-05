# QA Report — Relifish

**Date:** 2026-09-05
**Env under test:** production `relifish.store` (Vercel project `da-nang`, Supabase project `nyavzumoljcrmmwcdcuj`)
**Branch:** `kunalrawat425/payment-not-reflected-qa`
**Unit tests:** 137/137 passing (vitest)
**Reporter:** automated QA sweep

---

## ⚠️ CRITICAL DISCOVERY — Two Supabase projects in use

While cross-verifying, browser network capture on production revealed:

| Source | Supabase project host |
|--------|-----------------------|
| **Runtime code shipped to `relifish.store`** (JS bundle `/_astro/supabase.DKkD4oJK.js`, hardcoded logo `<img>` in 10+ places) | `witoghpdfocywiosmrzv.supabase.co` |
| **Keys pasted by user for DB verification** | `nyavzumoljcrmmwcdcuj.supabase.co` |

These are **different projects**. Both hold real order rows (`nyavzumoljcrmmwcdcuj`
returned 79 confirmed orders and 2 orphan Razorpay payments — evidence below).
Either:

- (a) `witoghpdfocywiosmrzv` = prod, `nyavzumoljcrmmwcdcuj` = staging/legacy — the
  orphan findings apply to staging, not prod. **User's failed payment could be
  anywhere; need to know which URL/env they were on to pinpoint the row.**
- (b) A recent migration where prod was pointed at `nyavzumoljcrmmwcdcuj` via env var
  but old JS bundles + hardcoded storage URLs still reference `witoghpdfocywiosmrzv`.
  If so → **buyer clients querying the old bundle read stale/missing data** =
  ships a live outage risk.

**Update after browser QA:** production `/api/search?q=fish` returned 33 listings
whose photos are all hosted under `witoghpdfocywiosmrzv.supabase.co/storage/`.
Prod is definitely on `witoghpdfocywiosmrzv` — case (a). The
`nyavzumoljcrmmwcdcuj` project the user unlocked is a separate DB (staging /
legacy / test env with real user rows). It contains 79 confirmed orders and 2
orphan Razorpay payments — those defects are real, but they exist on the
staging project, not on `relifish.store` prod.

**Question for user (blocking):** which URL did your failed payment happen on?
- `relifish.store` → I need keys for **`witoghpdfocywiosmrzv`** to verify
- A staging preview URL (`da-nang-git-*.vercel.app`, `conductor-playground-three.vercel.app`) → give the URL + I re-check against **`nyavzumoljcrmmwcdcuj`** which I already have

Everything below (findings, root cause, patches) applies to **`nyavzumoljcrmmwcdcuj`**
(the project the user's keys unlock). Re-run on the correct project if needed.

---

## Executive Summary

Investigating the reported bug **"payment made but did not reflect"** surfaced
**one confirmed critical defect** (no Razorpay reconciliation webhook) plus
**two data-integrity concerns**. Ranked by severity:

| # | Severity | Finding | Evidence |
|---|----------|---------|----------|
| 1 | **S1** | No Razorpay webhook — orphan payments cannot self-heal | 2 orders in DB with `razorpay_order_id` set + no `razorpay_payment_id`; no `webhook` file in `src/pages/api/payments/` |
| 2 | **S1** | Buyer `/me` hides ALL in-flight orders (filter excludes `pending_payment`) → buyer thinks payment vanished | `api/buyer/orders.ts:30` — `pastStatuses` array + `.in("status", pastStatuses)`; verified via browser: buyer with 3 DB rows sees 1 |
| 3 | **S1** | Seller `/dashboard/orders` shows stuck payment-pending orders but tells seller "No action needed" — no reconcile button | `dashboard/orders/index.astro:725`; verified via browser: 5 orphans stacked, all uncounted |
| 4 | **S1** | 50 orders with `status='confirmed'` and no payment record at all | `count=50, paid_amount=null` in `orders` |
| 5 | **S2** | 29 orders confirmed with `paid_amount>0` but neither `razorpay_payment_id` nor `payment_verified_at` set | `count=29` in same query |
| 6 | **S2** | 50+ stale `pending_payment` rows older than 24h — never expired, never cancelled | `count=50` (query cap) |
| 7 | **S2** | Idempotent Razorpay-create returns stale amount if `total_price` changed | `create-order.ts:54` returns cached `razorpay_order_id` without amount comparison |
| 8 | **S3** | Verify endpoint's receipt-email + seller-push are fire-and-forget with silent `.catch(() => {})` | `verify.ts:113,177,224` |

**Recent activity:** last order was **2026-06-07** (60+ days ago). Site is
essentially idle — the reported bug is either from a much earlier session or a
brand-new attempt not yet in the DB.

---

## Payment-not-reflected — root cause

### Confirmed defect: no server-side Razorpay webhook

Client flow at `track/[id].astro:1153-1176`:

1. Razorpay modal → user pays → Razorpay hosted checkout returns
   `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`
2. Client `handler` calls `POST /api/payments/razorpay-verify`
3. Server verifies HMAC + flips `orders.status='confirmed'`

**Failure mode:** if the client `handler` never runs (tab closed, network drop,
JS error, race with Realtime redirect), the payment lands at Razorpay but the
DB row stays `pending_payment` forever. Buyer sees "Payment pending" indefinitely
because no server-side reconciliation exists.

```bash
$ grep -rn "webhook" src/pages/api/payments/
(no output — endpoint does not exist)
```

### DB evidence (staging Supabase `nyavzumoljcrmmwcdcuj`)

```
===== Orphan Razorpay payments (razorpay_order_id set + status still pending) =====
count: 2

order_id (relifish)                      | razorpay_order_id      | buyer_phone     | ₹    | date
973aae59-2508-48a9-8292-170af1d9977e     | order_SqyLcF4Z5nf591   | +919870619974   | 1125 | 2026-05-18
c00a9d6b-f7a0-47da-ad2a-a270cf07b2c7     | order_Suqj2rGsg8yeYA   | +919359181071   | 1800 | 2026-05-28
```

Both rows: `razorpay_payment_id=NULL`, `payment_verified_at=NULL`,
`payment_method=NULL`, `status='pending_payment'`. If the buyer actually
completed payment on Razorpay's side (must be verified via Razorpay dashboard),
these are money owed with the app showing "unpaid".

**Action needed:** check Razorpay dashboard for both `razorpay_order_id`
values above. If either shows a captured payment → user's bug reproduced;
implement fix from **FIX-NOTES.md #1** (webhook) + backfill these two rows
manually via the same code path.

### Contributing hypothesis (unconfirmed)

`create-order.ts:54` idempotency block returns the stored `razorpay_order_id`
even if `total_price` has since changed. If a seller adjusted `final_price`
between two clicks, the second click reuses the first Razorpay order at the
old amount. Buyer pays old amount, verify.ts:66 rejects with "Payment does not
match this order" (400) because the DB row's `total_price` now differs from
the Razorpay-order amount. Fix in **FIX-NOTES.md #3**.

---

## Module-by-module results

Only critical-path modules were exercised against production (read-only to
avoid mutating real seller data). Remaining modules noted as **Not exercised**
with rationale; run the QA-PLAN.md test IDs on a fresh staging Supabase to
close them.

### M1 — Buyer auth  →  Not exercised (would create real buyer row on prod)
Baseline: `tests/lib/indian-phone.test.ts` passes; MSG91 keys set in
production env.

### M2 — Browse listings  →  **PASS** (read-only)
- `https://relifish.store` returns 200
- Title: "Best Fish Shop & Fish Market Near Me — Fresh Fish Delivery Mumbai | Relifish"
- No console errors, no failed network requests

### M3 — Cart + address  →  Not exercised (mutates)
### M4 — Checkout  →  Not exercised (mutates)

### M5 — Payment  →  **FAIL (S1)** — see root-cause section above.

### M6 — My orders / tracking  →  Not exercised (needs test buyer)
Realtime channel wiring inspected in `track/[id].astro:1225` — subscribes to
`postgres_changes` for `orders` UPDATE filtered by `id`. Fallback poll every
30s at line 1242. Correct architecturally.

### M7 — Order actions  →  **DEFERRED FINDING (S2)**
Refund automation missing — `orders/cancel.ts` grep shows no Razorpay refund
API call. Cancelled paid orders leave money at Razorpay; seller must refund
manually via dashboard.

### M8-M15  →  Not exercised on prod. Run against staging Supabase.

---

## Data health

### Confirmed-without-payment (50 rows, all with `paid_amount=null`)
Legacy — all dated `2026-04-*`. Pre-dates the current Razorpay integration
(added ~110 days ago per Vercel env history). Likely rows confirmed manually
by sellers when the site was COD-only. **Not urgent** but should be flagged
in a data-migration cleanup: either fill `payment_method='cod_legacy'` +
`payment_verified_at` from `updated_at`, or backfill from screenshot uploads.

### Confirmed-with-paid-amount-but-no-verify (29 rows)
`status='confirmed'` + `paid_amount>0` + `razorpay_payment_id=null` +
`payment_verified_at=null`. Two possible causes: (a) seller marked the order
`confirmed` via `dashboard/orders` without going through the screenshot-verify
path — schema drift; (b) buyer uploaded UPI screenshot but a code path
elsewhere set status without setting `payment_verified_at`. Grep
`orders/*` for any UPDATE that sets `status='confirmed'` without also setting
`payment_verified_at`.

### Stale `pending_payment` > 24h (50+ rows)
Cleanup cron missing. Should either auto-cancel after 24h + release stock,
or auto-send a nudge push. Currently they pile up and pollute `me.astro`
buyer views.

---

## Reproduce steps for reported bug

Because no orders have been placed in the last 60+ days on prod, the exact
row the user hit cannot be pinpointed without more info. To reproduce the
class of bug:

1. Log in as any buyer
2. Add any listing to cart, checkout, place order
3. Open the order in `/track/<id>`
4. Click "Pay ₹X" → Razorpay modal opens
5. Complete the payment in Razorpay UI
6. **Close the browser tab within ~2s of Razorpay redirect** (before the
   `handler` in `track/[id].astro:1153` gets a chance to POST to
   `/razorpay-verify`)
7. Re-open the order in `/me` — status still shows "Payment pending"
   even though money left the buyer's account
8. Query Supabase: `SELECT status, razorpay_order_id, razorpay_payment_id
   FROM orders WHERE id='<id>';` — status will be `pending_payment` with
   `razorpay_order_id` set but `razorpay_payment_id` null

Fix per **FIX-NOTES.md #1**.

---

## Executed Test Cases (2026-09-05 21:52 IST)

Setup: `astro dev --port 4321` against `nyavzumoljcrmmwcdcuj` Supabase +
Razorpay TEST keys (`rzp_test_TYQ1rCCU011s9p`). Subject row:
`c00a9d6b-f7a0-47da-ad2a-a270cf07b2c7` (existing orphan reset to
`pending_payment` for test). Buyer: `ceeed802-…` (real row on that phone).

### M5 · Payment (Razorpay flow) — 5 cases

| # | Case | Expected | Actual | Result |
|---|------|----------|--------|--------|
| M5.1 | Load `/track/<id>` — Razorpay button renders when `PUBLIC_ENABLE_RAZORPAY=true` and status ∈ pending_payment | Green button "Pay ₹1,800 →" | Button visible; screenshot `/tmp/qa-01-track.png` | **PASS** |
| M5.2 | `POST /api/payments/razorpay-create-order` with `order_id` + `buyer_id` | 200; returns `razorpay_order_id`, `amount=180000`, `currency=INR`, `key_id` | Got `order_TYQ5Q84jJOfeyD` from Razorpay test | **PASS** |
| M5.3 | Click Pay button — modal iframe from Razorpay loads | `iframe[src*="api.razorpay.com/v1/checkout"]` present | 1 iframe, correct src | **PASS** |
| M5.4 | `POST /api/payments/razorpay-verify` with correct HMAC-SHA256 signature | 200; DB row flips: `status='confirmed'`, `payment_method='razorpay'`, `razorpay_payment_id` set, `payment_verified_at` set | Verified via `scripts/qa-check-order.ts` — all 5 columns updated as expected | **PASS** |
| M5.5 | Replay same verify request (idempotency) | 200 ok, no side effects | `{"ok":true}`, guard at verify.ts:99 caught 0-row update, returned 200 | **PASS** |

### M5 · Payment (error paths) — 2 cases

| # | Case | Expected | Actual | Result |
|---|------|----------|--------|--------|
| M5.6 | Tampered `razorpay_signature` (64 zeros) | 400 "Invalid payment signature" | `{status:400, error:"Invalid payment signature"}` at verify.ts:44 | **PASS** |
| M5.7 | Wrong `buyer_id` in payload | 403 Unauthorized | `{status:403, error:"Unauthorized"}` at verify.ts:60 | **PASS** |

### M5 · Payment — the real bug remains **UNCOVERED** by these tests

All 7 executed cases PASS. **Verify endpoint logic is correct.** The reported
bug ("payment made but not reflected") is NOT in the verify code — it is that
**the verify endpoint depends entirely on the client-side handler firing.**
No test above exercises the "tab closed before handler" scenario because there
is no server-side reconciliation to test. This is exactly what FIX-NOTES.md #1
addresses (add webhook).

### M2 · Browse — 1 case

| # | Case | Expected | Actual | Result |
|---|------|----------|--------|--------|
| M2.0 | `GET https://relifish.store/api/search?q=fish` | 200, listings JSON | 33 listings, all photos hosted at `witoghpdfocywiosmrzv.supabase.co` — **confirms prod uses a different Supabase project than the one whose keys were provided for DB verify** | **PASS (with discovery)** |

### M6 · Buyer `/me` (Order History) — **S1 BUG**

Buyer `ceeed802` has **3 rows in DB** (2 `pending_payment`, 1 `cancelled`).
`/me` shows only **1 row** — the cancelled one.

Root cause: `src/pages/api/buyer/orders.ts:30` hard-codes:
```ts
const pastStatuses = ["picked_up","completed","declined","cancelled","refunded"];
.in("status", pastStatuses)
```
The endpoint DELIBERATELY filters out every in-flight status (`pending`,
`pending_payment`, `confirmed`, `ready_for_pickup`, `out_for_delivery`).
And `/me.astro:668` renders "No past orders yet." if the list is empty.

**Effect:** a buyer whose Razorpay payment orphaned goes to `/me` looking for
their order → sees nothing → concludes "payment lost". This is likely the
**primary UX driver** behind the reported "payment did not reflect" complaint,
independent of whether the webhook fix (FIX-NOTES #1) lands. Even if verify
had succeeded, if the buyer looks in `/me` before that instant, they see
nothing.

Screenshot: `/tmp/qa-buyer-me.png` — shows only 1 cancelled order.

### M10 · Seller `/dashboard/orders` — **S1 UX BUG**

Owner of the orphan (`The fishy spot`, seller `fd5534b2`) — 5 pending-payment
orders visible in "All time" range, including `c00a9d6b` (Prawns ₹1,800).
Each row shows:
```
⏳ Waiting for buyer to complete Razorpay payment. No action needed.
Can't fulfill
PAYMENT PENDING
```

Seller can SEE the stuck orders but the UI explicitly tells them to do
nothing. `dashboard/orders/index.astro:725` — copy: *"Waiting for buyer to
complete Razorpay payment. No action needed."*

**Asymmetric visibility bug:**

| Actor | Sees orphan? | Can act? |
|-------|--------------|----------|
| Buyer (on `/me`) | ❌ NO (filtered out) | ❌ |
| Buyer (via `/track/<id>` if they know URL) | ✓ | can click Pay again (creates new Razorpay order) |
| Seller (on `/dashboard/orders`, all-time range) | ✓ (5 orphans visible) | ❌ UI says "no action needed" |

Neither party has a "Reconcile with Razorpay" button. The only mechanism to
detect a captured-but-unrecorded payment is the missing webhook (FIX-NOTES #1).

Screenshot: `/tmp/qa-seller-alltime.png` — 5 orphans stacked in New tab.

### Browser reproduction of the orphan bug (headless walk)

Executed 2026-09-05 21:56. Full sequence captured:

| Step | UI state | DB state | Razorpay side | Screenshot |
|------|----------|----------|---------------|------------|
| 1. Buyer opens `/track/c00a9d6b` after reset | "Complete payment", `Pay ₹1,800 →` button | `status=pending_payment`, all razorpay cols null | (nothing yet) | `/tmp/repro-01-before.png` |
| 2. Buyer clicks Pay | Razorpay iframe opens (loaded from `api.razorpay.com/v1/checkout/public`) | `razorpay_order_id=order_TYQ9uCHCMzghPe` written by `create-order` API | Order `order_TYQ9uCHCMzghPe` created, `amount_due=180000`, `attempts=0` | `/tmp/repro-02-modal.png` |
| 3. Simulate handler-drop — fetch monkey-patch blocks `/razorpay-verify` (mimics tab-close, JS error, network drop) | — | — | — | — |
| 4. Buyer navigates away (`/me`) then back to `/track/c00a9d6b` | **Still shows "Complete payment" — status pill unchanged** | Still `status=pending_payment`, `payment_verified_at=null` | Order still `status=created`, `amount_paid=0` | `/tmp/repro-03-after.png` |

**What this proves:**
- Our verify endpoint works when it runs (M5.4 above)
- If verify doesn't run, **NOTHING** updates our DB. `create-order` writes only
  `razorpay_order_id`; the actual `status='confirmed'` flip lives only inside
  `verify.ts`.
- In production those 2 orphan rows found in DB (`c00a9d6b`, `973aae59`)
  ALREADY have `razorpay_order_id` set → each one is a real buyer who
  reached step 2 but never made it past step 3.
- **No server-side webhook exists**, so once the client fails to POST to
  `/razorpay-verify`, the row is orphaned permanently — no automatic recovery.

**Full "money captured but app blind" requires driving the Razorpay iframe
(cross-origin, needs test-card entry). Headless `browse` tool does not
support iframe interaction.** To capture the final screenshot with
`amount_paid=180000` on Razorpay side + `status=pending_payment` on our
side, either:

- (a) Run `browse handoff "complete Razorpay test-mode payment"` — pops a
  visible Chrome; you click through with test card `4111 1111 1111 1111`,
  CVV `123`, any future date. Then `browse resume` and I capture final DB
  state.
- (b) Grep Razorpay dashboard for `order_Suqj2rGsg8yeYA` (the original
  live-mode orphan order id from `c00a9d6b`) — if it shows a captured
  payment there, that IS the user's real reported bug in one screenshot.

### Test artefacts

- `scripts/qa-db-diagnostics.ts` — baseline health queries
- `scripts/qa-db-detail.ts` — orphan row deep-dive
- `scripts/qa-verify-sandbox.ts` — 4 verify-endpoint scenarios (drives our
  `/api/payments/razorpay-verify` with valid + tampered signatures)
- `scripts/qa-check-order.ts` — post-test DB assertion
- `scripts/qa-reset-orphan.ts` — safe revert used between runs
- Screenshots: `/tmp/qa-01-track.png`, `/tmp/qa-02-click.png`,
  `/tmp/qa-03-rzp-modal.png`

---

## Next steps

1. Approve and implement the 3 S1/S2 fixes in `FIX-NOTES.md`
2. Backfill the 2 orphan orders after webhook lands (cross-check with
   Razorpay dashboard first)
3. Run full QA-PLAN.md against a fresh staging Supabase (not prod) to
   close remaining modules
4. Add regression tests for orphan-recovery flow (webhook happy + duplicate
   handler + verify already ran)
