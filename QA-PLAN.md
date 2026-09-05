# QA Plan — Relifish Full User-Flow Pass

**Target:** https://conductor-playground-three.vercel.app (staging)
**Branch:** `kunalrawat425/payment-not-reflected-qa`
**Scope:** 15 modules, module-by-module, cross-verified against Supabase.
**Baseline unit tests:** 137/137 (vitest).

Each test case = one row. Columns: **ID · Steps · Expected UI · Expected DB
row state · Severity if failing**. Severity keys: **S1** blocker (ships-no-go),
**S2** major (revenue/UX impact), **S3** minor (polish).

Test IDs use the module tag (M1–M15) + numeric suffix.

---

## M1 — Buyer auth (OTP via MSG91)

| ID | Steps | Expected UI | Expected DB |
|----|-------|-------------|-------------|
| M1.1 | Open `/`, click Login, enter valid Indian phone (10 digits) | OTP screen | none yet |
| M1.2 | Submit correct OTP | Modal closes, avatar shows phone | `buyers` row: `phone=<num>`, `id` = new uuid; `localStorage.rlf_buyer_id` set |
| M1.3 | Submit wrong OTP 3× | Error toast, cooldown | no row change; MSG91 attempt-count incremented |
| M1.4 | Enter 9-digit phone | Client blocks — "Enter 10-digit phone" | no request sent (verify Network tab) |
| M1.5 | Enter phone that already has a buyer row | Same `buyer_id` returned — no duplicate row | 1 row per phone; unique constraint on `buyers.phone` |
| M1.6 | Logout (clear localStorage), re-login same phone | Same `buyer_id` restored via lookup | no new row |

**Failing S:** M1.2/M1.5 = **S1**; rest = S2.

## M2 — Browse listings

| ID | Steps | Expected UI | Expected DB (read-only checks) |
|----|-------|-------------|-------------|
| M2.1 | Open `/shop` | Grid of listing cards | `fish_listings.stock_qty > 0`, `sellers.is_active=true`, `is_verified=true` |
| M2.2 | Open `/s/<slug>` | Detail page: photos, species, pricing_options, seller card | listing row `id` matches slug |
| M2.3 | Search "surmai" via `/search` | Only surmai listings | `species ILIKE '%surmai%'` matches |
| M2.4 | `/area/thane` | Listings only from Thane sellers | `sellers.location_city='Thane'` |
| M2.5 | `/seller/<id>` | Seller profile + their listings | rows filtered by `seller_id` |
| M2.6 | View listing with `pricing_options` (bundle) | Each option renders own row with correct total | JSON `pricing_options` array, `bundle_size>1` |
| M2.7 | View sold-out listing | Card shows "Sold out" badge; add-to-cart disabled | `stock_qty=0` |
| M2.8 | Inactive seller listing | Not shown in shop | `is_active=false` filtered |

**Failing S:** M2.1/M2.2 = **S1**.

## M3 — Cart + address

| ID | Steps | Expected UI | Expected DB |
|----|-------|-------------|-------------|
| M3.1 | Logged in, add 1 kg to cart | Cart drawer opens, subtotal correct | `buyer_cart` row inserted with `buyer_id`, `listing_id`, `quantity=1` |
| M3.2 | +/- qty in drawer | Subtotal updates immediately | `buyer_cart.quantity` PATCHed |
| M3.3 | Remove line | Line disappears; empty state if last | row deleted |
| M3.4 | Refresh page | Cart persists | rows still present |
| M3.5 | Add second listing from **different seller** | Reject or force-clear old cart | contract to verify: does `validate-cart` block? |
| M3.6 | Add > `stock_qty` | Error message | `validate-cart` returns 400 |
| M3.7 | Open OrderAddressSheet → allow geolocation | Map pins current location | temporary — no write until save |
| M3.8 | Save address | Card appears in address list | `buyer_addresses` row: `lat`, `lng`, `label` |
| M3.9 | Delivery address outside seller radius | Warning; delivery option disabled | `validate-cart` returns delivery_available=false |

**Failing S:** M3.1/M3.4/M3.8 = **S1**; M3.5/M3.9 = **S2**.

## M4 — Checkout (place order)

| ID | Steps | Expected UI | Expected DB |
|----|-------|-------------|-------------|
| M4.1 | Open CheckoutSheet, step 1 → step 2 → "Place order" (pickup) | Success toast; redirect to order list or track page | `orders` row: `status='pending_payment'`, `order_type='pickup'`, `delivery_fee=0`, `total_price` matches subtotal |
| M4.2 | Same, but delivery | Same success | `order_type='delivery'`, `delivery_fee>0` per seller config |
| M4.3 | Seller pickup-only listing | Delivery option hidden (CheckoutSheet:50) | n/a |
| M4.4 | Seller delivery-only listing | Pickup option hidden | n/a |
| M4.5 | Not logged in → tap Place order | Login modal opens first | no row until login |
| M4.6 | Preorder listing beyond cutoff | Block with message | `orders.is_preorder=true` only if placed within cutoff |
| M4.7 | Concurrent double-tap Place order | Only one row inserted | `create_order_atomic` RPC prevents duplicate via `SELECT FOR UPDATE` |
| M4.8 | RPC fallback path (simulate by breaking RPC) | Row still inserted via fallback | manual — inspect `create.ts:305` branch |

**Failing S:** M4.1/M4.2/M4.7 = **S1**.

## M5 — Payment (PRIMARY BUG SURFACE)

### Razorpay branch (`PUBLIC_ENABLE_RAZORPAY=true`)

| ID | Steps | Expected UI | Expected DB |
|----|-------|-------------|-------------|
| M5.1 | Open pending order in `track/[id]` | Razorpay pay button rendered with correct amount | `orders.status='pending_payment'`, `razorpay_order_id` null (until click) |
| M5.2 | Click Pay → complete test payment (card 4111 1111 1111 1111 / any future / 123) | Green "Payment confirmed" panel | `status='confirmed'`, `payment_method='razorpay'`, `razorpay_payment_id` present, `payment_verified_at` set |
| M5.3 | Repeat click while still `pending_payment` | Same `razorpay_order_id` re-used (idempotent) | row unchanged except one existing `razorpay_order_id` |
| M5.4 | Dismiss Razorpay modal without paying | Button restores; no DB write | row unchanged |
| M5.5 | Tamper signature (manual: intercept + edit response) | Red "confirmation failed" panel with payment id | `status` unchanged; NO update |
| M5.6 | Call `/razorpay-verify` twice with same payload | Second returns 200 idempotently | row set once |
| M5.7 | Order paid; refresh — Realtime should reflect | Status = "Confirmed" within ~2s | already `confirmed` |
| M5.8 | Fake `localStorage.rlf_buyer_id` before verify | 403 Unauthorized | row unchanged |
| M5.9 | Seller updates `final_price` between create-order and pay | **BUG risk** — stale amount charged | verify `razorpay_order_id` amount vs order total delta |
| M5.10 | Close tab immediately after Razorpay success but before `handler` runs | **BUG** — orphan payment; no webhook exists | check Razorpay dashboard vs DB row status mismatch |

### Screenshot branch (`PUBLIC_ENABLE_RAZORPAY=false`)

| ID | Steps | Expected UI | Expected DB |
|----|-------|-------------|-------------|
| M5.11 | Open pending order | UPI card + upload widget | `status='pending_payment'` |
| M5.12 | Upload screenshot | Toast success | `payment_screenshot_urls` array populated |
| M5.13 | Seller verifies via dashboard | Buyer sees "Confirmed" | `status='confirmed'`, `payment_verified_at` set, `payment_verified_by=<seller_id>` |
| M5.14 | Seller rejects screenshot | Buyer sees rejection reason; re-upload allowed | check `api/seller/payment-screenshot.ts` behaviour |

**Failing S:** M5.2/M5.5/M5.6/M5.10 = **S1**. M5.9 = **S1** if amount mismatches. Others S2.

## M6 — My orders / tracking

| ID | Steps | Expected UI | Expected DB |
|----|-------|-------------|-------------|
| M6.1 | Login → `/me` | List of buyer's orders newest first | `orders` filtered by `buyer_id`, ORDER BY created_at DESC |
| M6.2 | Tap order → `/track/<id>` | Detail with stepper | matches row |
| M6.3 | Seller changes status via dashboard | Realtime updates within 2s | Supabase channel `order-<id>` fires |
| M6.4 | Disconnect internet, seller changes status, reconnect | 30s poll fallback catches up | (check `pollTimer` at line 1242) |
| M6.5 | `/track` (no id), enter order-id + phone | Order shown to anonymous user | phone match on `orders.buyer_phone` |
| M6.6 | Cancelled order | Stepper shows "Cancelled"; refund row info | `status='cancelled'` |
| M6.7 | Preorder → seller sets `final_price` higher than `paid_amount` | Banner: "Pay balance ₹X" | `final_price > paid_amount` |

**Failing S:** M6.1/M6.3 = **S1**.

## M7 — Order actions

| ID | Steps | Expected UI | Expected DB |
|----|-------|-------------|-------------|
| M7.1 | Cancel a `pending_payment` order | Success | `status='cancelled'` |
| M7.2 | Cancel a `confirmed` (Razorpay-paid) order | Success + refund notice | manual Razorpay refund not automated — flag as **S2** |
| M7.3 | Cancel a `dispatched` order | Blocked | server returns 400 |
| M7.4 | Submit feedback (rating + comment) | Toast | `order_feedback` row inserted, unique per order |
| M7.5 | Update buyer notes | Persisted | `orders.buyer_notes` updated |

## M8 — Seller onboarding

| ID | Steps | Expected UI | Expected DB |
|----|-------|-------------|-------------|
| M8.1 | `/for-sellers` → CTA → `/dashboard/login` | OTP flow | analogous to M1 but writes `sellers` |
| M8.2 | Complete profile (name, address, WhatsApp) | Redirect to `/dashboard/pending` | `sellers.name`, `.lat`, `.lng`, `.whatsapp` set, `is_active=false`, `is_verified=false` |
| M8.3 | Try to reach `/dashboard/listings` without verify | Blocked by `SellerActiveGate` | UI redirect |
| M8.4 | Admin flips `is_verified=true` | Seller now sees listings dashboard | manual DB step |

## M9 — Seller listings

| ID | Steps | Expected UI | Expected DB |
|----|-------|-------------|-------------|
| M9.1 | Create listing (species, per-kg price, stock) | Listing appears in `/dashboard/listings` and `/shop` | `fish_listings` row inserted |
| M9.2 | Add bundle `pricing_options` (e.g., 500g bundle) | Renders bundle option on buyer side | `pricing_options` JSON array with `bundle_size` |
| M9.3 | Upload listing photo | Photo shown | Supabase storage URL persisted |
| M9.4 | Edit stock to 0 | "Sold out" badge on buyer side | `stock_qty=0` |
| M9.5 | Delete listing | Removed from shop | soft-delete flag OR hard delete — verify |

## M10 — Seller orders + fulfillment

| ID | Steps | Expected UI | Expected DB |
|----|-------|-------------|-------------|
| M10.1 | Open `/dashboard/orders` | List of orders assigned to this seller | filtered by `seller_id` |
| M10.2 | Razorpay-paid order | "Auto-confirmed" green pill; skip screenshot verify | `payment_method='razorpay'` |
| M10.3 | Screenshot order | "Verify screenshot" action | `payment_screenshot_urls` present, `payment_verified_at` null |
| M10.4 | Verify screenshot | Row moves to next stepper stage | `payment_verified_at` set |
| M10.5 | Mark ready | Buyer stepper reflects | `status='ready_for_pickup'` or `'out_for_delivery'` |
| M10.6 | Mark picked-up / completed | Terminal state | `status='picked_up'` or `'completed'` |
| M10.7 | Set `final_price` | Balance-due UI on buyer side | `final_price` set |
| M10.8 | Upload refund screenshot | Buyer sees refund proof | `refund_screenshot_url` set |
| M10.9 | Export orders CSV | File downloads | manual UI verify |

## M11 — Preorders

| ID | Steps | Expected UI | Expected DB |
|----|-------|-------------|-------------|
| M11.1 | `/preorder` — pick tomorrow's slot before cutoff | Order placed | `orders.is_preorder=true`, `scheduled_for` set |
| M11.2 | Same, after cutoff | Blocked | 400 error |
| M11.3 | Preorder confirmed → seller catches → sets `final_price` | Buyer sees final and pays balance if higher | `final_price` set; balance flow triggers |
| M11.4 | Preorder → no catch (seller cancels) | Full refund path | refund status |

## M12 — Push notifications

| ID | Steps | Expected UI | Expected DB |
|----|-------|-------------|-------------|
| M12.1 | Enable browser push | Permission modal + subscribe | `buyer_push_subscriptions` row inserted |
| M12.2 | Place order → confirm | Push received "Order placed" | check via `notify-seller` + `buyer-push` server calls |
| M12.3 | Seller marks ready | Push "Ready for pickup" | |
| M12.4 | Order cancelled | Push "Cancelled" | |
| M12.5 | Cron `remind-sellers` with `CRON_SECRET` | 200 OK; unrated sellers get nudge | check log |

## M13 — Address / geolocation

| ID | Steps | Expected UI | Expected DB |
|----|-------|-------------|-------------|
| M13.1 | LocationPicker — allow geo | Auto-pin | temp |
| M13.2 | Deny geo → manual pin drop | Works | temp |
| M13.3 | Save without geo | Client blocks or defaults? | verify behaviour |
| M13.4 | Delete address | Removed | row deleted |
| M13.5 | Address used on active order → delete | Should block or soft-delete | verify FK behaviour |

## M14 — Marketing pages

| ID | Steps | Expected |
|----|-------|----------|
| M14.1 | `/` — hero → CTA → shop | No dead link |
| M14.2 | Analytics tags fire (GA4, GTM, Clarity, FB Pixel, Firebase) | Network tab shows requests |
| M14.3 | `/for-sellers` → waitlist form | POST `/api/waitlist/join` writes row |
| M14.4 | Blog posts render, no 500 | 200 status |
| M14.5 | `/terms`, `/privacy`, `/refund-policy`, `/about` | Load OK |
| M14.6 | `/sitemap.xml`, `/pricing.md` | Valid response |
| M14.7 | 404 route | `/404.astro` shows |

## M15 — Cron + admin

| ID | Steps | Expected |
|----|-------|----------|
| M15.1 | Curl `/api/cron/remind-sellers` without `CRON_SECRET` | 401 |
| M15.2 | With correct secret | 200 + reminder sent |
| M15.3 | Curl `/api/cron/meat-day-promo` similarly | Auth-gated |
| M15.4 | `vercel.json` cron schedule matches | Manual inspect |

---

## Execution sheet template (fill during run)

For every case above, log:

```
ID    | Result (PASS/FAIL/SKIP) | Actual UI | Actual DB row | Screenshot | Severity | Fix ref
```

Output goes into **QA-REPORT.md**. Blocking findings escalate to **FIX-NOTES.md**
with patch suggestions and referenced line numbers.
