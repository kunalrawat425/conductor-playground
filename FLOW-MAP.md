# Relifish — Full System Flow Map

Complete inventory of user types, order variants, stage machines, modules, and
the API/table dependencies at each edge. Read this before running any QA case
so tests hit every branch, not just the happy path.

## 1. User Types

| Type | Storage | Auth | Sees |
|------|---------|------|------|
| **Anonymous visitor** | none | none | marketing pages, `/shop`, `/s/[slug]`, `/track` (with order-id + phone) |
| **Buyer (registered)** | `buyers` row · `localStorage.rlf_buyer_id` + `rlf_phone` | MSG91 OTP (10-digit Indian) | full storefront + `/me` + `/track/[id]` for own orders + cart + push |
| **Buyer (anonymous with placed order)** | order row keyed by `buyer_phone`; NO `buyer_id` | phone lookup on `/track` | can view single order, cannot see `/me` list |
| **Seller (pending)** | `sellers` row · `is_active=false` `is_verified=false` | MSG91 OTP + dashboard cookie | `/dashboard/pending`, edit profile only |
| **Seller (active)** | `sellers.is_active=true` `is_verified=true` | same | listings + orders + fulfillment |
| **Cron / system** | none | `Authorization: Bearer $CRON_SECRET` header | reminder + promo endpoints |

## 2. Order Types

Two axes multiply into six real variants.

|   | Same-day | Pre-order |
|---|----------|-----------|
| **Pickup** | Cash-flow: pay-first, seller confirms, buyer picks up | Range price paid upfront; final set post-catch; balance-due or refund |
| **Delivery** | Adds `delivery_fee`, `buyer_addr` required, distance check | Same, plus delivery address |
| **Legacy COD** | 50 rows exist pre-Razorpay era; `payment_method=null`, `paid_amount=null`, seller-confirmed manually | (none — pre-order postdates Razorpay) |

Column signature per type:

| Type | `is_preorder` | `placement_kind` | `scheduled_for` | `paid_amount` | `final_price` |
|------|---------------|-------------------|-----------------|---------------|---------------|
| Same-day pickup | false | `same_day` | null | `total_price + delivery_fee` | null |
| Same-day delivery | false | `same_day` | null | same | null |
| Pre-order pickup | true | `preorder` | tomorrow slot | listing.price × qty (range midpoint or min) | set post-catch |
| Pre-order delivery | true | `preorder` | tomorrow slot | same | same |
| Legacy COD | false | null | null | null | null |

## 3. Payment Rails

Three mutually-exclusive paths. Gated by `PUBLIC_ENABLE_RAZORPAY` and by
existing DB state.

```
┌─────────────────────────────────────────────────────────────────┐
│  Rail A · Razorpay (PUBLIC_ENABLE_RAZORPAY="true", not balance) │
├─────────────────────────────────────────────────────────────────┤
│  1. renderRazorpayButton  (track/[id].astro:1064)               │
│  2. POST /api/payments/razorpay-create-order                    │
│       └─ Razorpay API creates order, stores razorpay_order_id   │
│  3. Load Razorpay checkout.js, open modal                       │
│  4. User pays; handler receives {order_id,payment_id,signature} │
│  5. POST /api/payments/razorpay-verify                          │
│       └─ HMAC-SHA256 check + UPDATE orders → status='confirmed' │
│  6. Buyer sees green panel; seller push + email fire            │
│                                                                 │
│  FAILURE SURFACES:                                              │
│  • Tab closes between step 4 and 5 → orphan (no webhook exists) │
│  • Signature mismatch → 400, red "confirmation failed" panel    │
│  • razorpay_order_id ≠ stored on row → 400 replay reject        │
│  • Order not in [pending, pending_payment] → 400 already-done   │
│  • Stale amount (idempotency cached older total) → 400 mismatch │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Rail B · UPI screenshot (PUBLIC_ENABLE_RAZORPAY!="true"        │
│           OR "balance" kind — pre-order final-price top-up)     │
├─────────────────────────────────────────────────────────────────┤
│  1. UPI ID + amount card shown                                  │
│  2. User pays externally via any UPI app                        │
│  3. Uploads screenshot: POST /api/orders/upload-payment         │
│       └─ writes to orders.payment_screenshot_urls[] array       │
│  4. Seller verifies via /dashboard/orders                       │
│  5. POST /api/seller/payment-screenshot (verify or reject)      │
│       └─ Sets status='confirmed', payment_verified_at, _by      │
│                                                                 │
│  FAILURE SURFACES:                                              │
│  • Seller never verifies → order stuck pending_payment (0 in DB │
│    currently, but no auto-nudge / cron)                         │
│  • Rejected screenshot flow not surfaced in QA yet              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Rail C · Legacy COD (pre-May 2026 orders)                      │
├─────────────────────────────────────────────────────────────────┤
│  Seller manually flips status='confirmed' from dashboard        │
│  Neither razorpay_payment_id nor payment_verified_at set        │
│  50 such rows in DB; needs backfill (FIX-NOTES.md #2)           │
└─────────────────────────────────────────────────────────────────┘
```

## 4. Order Status Machine (from `orders.status`)

```
                ┌──────────────────┐
                │ pending_payment  │ ← always the initial state on create
                └────────┬─────────┘
   Rail A verify OK      │      Rail B seller verify         Rail C seller click
        │                │                │                          │
        ▼                ▼                ▼                          ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │                          confirmed                                 │
   └───────────────────────────────┬───────────────────────────────────┘
                                   │
                seller marks ready │
                                   ▼
                       ┌───────────────────┐
                       │ ready_for_pickup  │  (pickup)
                       │ out_for_delivery  │  (delivery)
                       └────────┬──────────┘
                                │ seller completes
                                ▼
                        ┌───────────────┐
                        │  picked_up    │  → completed  (terminal)
                        └───────────────┘

Exit paths from any non-terminal state:
  • buyer cancel   → cancelled (only pending_payment or confirmed)
  • seller decline → declined  (any pre-fulfillment state)
  • refund flow    → refunded  (after cancelled/declined if paid)

Preorder-only intermediate:
  after status=confirmed, seller sets final_price:
    • final_price > paid_amount → balance-due UI; second payment rail
    • final_price < paid_amount → refund UI + refund_screenshot_path
    • final_price = paid_amount → straight to ready
```

Enum guardrail (from `all_migrations.sql`):
`{pending, pending_payment, confirmed, ready_for_pickup, out_for_delivery,
picked_up, completed, cancelled, declined, refunded}`

## 5. Modules × APIs × Tables — the crossmatrix

| Module | UI file | APIs | Primary tables |
|--------|---------|------|----------------|
| M1 Buyer OTP | `LoginModal.astro` | `send-otp`, `verify-otp` | `buyers` |
| M2 Browse | `shop`, `s/[slug]`, `search`, `area/[city]`, `seller/[id]` | `search`, `categories`, `sellers/nearby` | `fish_listings`, `sellers` |
| M3 Cart+addr | `OrderAddressSheet`, `LocationPicker` | `buyer/cart`, `buyer/validate-cart`, `buyer/addresses` | `buyer_cart`, `buyer_addresses` |
| M4 Checkout | `CheckoutSheet.astro` | `orders/create` (RPC `create_order_atomic`) | `orders`, `fish_listings` |
| M5 Payment | `track/[id].astro:1064` | `payments/razorpay-create-order`, `payments/razorpay-verify`, `orders/upload-payment` | `orders` (13 columns touched) |
| M6 Tracking | `me.astro`, `track/[id].astro`, `track.astro` | `buyer/orders`, `orders/detail` | `orders` |
| M7 Actions | `track/[id]` cancel button | `orders/cancel`, `orders/feedback`, `orders/update-notes` | `orders`, `order_feedback` |
| M8 Seller onboard | `for-sellers`, `dashboard/login`, `dashboard/profile`, `dashboard/pending` | `send-otp`, `verify-otp`, `seller/profile`, `seller/upload-store-photo` | `sellers` |
| M9 Listings | `dashboard/listings/*` | `seller/listings`, `seller/upload-listing-photo` | `fish_listings` |
| M10 Seller orders | `dashboard/orders/index.astro:713` | `seller/orders`, `seller/fulfillment`, `seller/payment-screenshot`, `seller/upload-refund`, `seller/orders-export` | `orders` |
| M11 Pre-order | `preorder/index.astro` | `orders/create` (preorder branch), `preorders` | `orders` |
| M12 Push | `LoginModal`, service worker | `buyer/push-subscribe`, `push-notify`, `notify-seller` | `buyer_push_subscriptions`, `seller_push_subscriptions` |
| M13 Addr geo | `LocationPicker.astro` | `buyer/addresses` | `buyer_addresses` |
| M14 Marketing | `index`, `for-sellers`, blog, `about`, `terms`, `privacy`, `refund-policy` | `waitlist/join`, `indexnow`, `chat`, `download/pitch-deck-ultra` | `waitlist` |
| M15 Cron/admin | — | `cron/remind-sellers`, `cron/meat-day-promo` | `sellers`, `orders` |

## 6. Data Anomalies to Verify (`nyavzumoljcrmmwcdcuj`)

Confirmed from DB queries in QA-REPORT.md:

- `fish_listings.stock_qty does not exist` — schema in this DB uses
  `weight_avail` (matches `/api/search` response). Migrations in
  `all_migrations.sql` reference `stock_qty` — schema drift.
- 2 orphan Razorpay orders (`c00a9d6b`, `973aae59`)
- 79 confirmed-without-payment orders (50 null paid_amount + 29 with)
- 50+ stale `pending_payment` older than 24h
- 0 orders in last 60+ days

Prod (`witoghpdfocywiosmrzv`) has 33 listings live; its DB not accessible without
separate keys.

## 7. Testing constraint — Razorpay sandbox

Currently in `.env`:
```
PUBLIC_RAZORPAY_KEY_ID=rzp_live_SqLAzccW5HWyNC   ← LIVE
RAZORPAY_KEY_SECRET=8Wry1ooITTDzZjZ22ddgT9b6      ← LIVE
```

**Cannot complete a real payment without spending real INR.** Live keys reject
test cards (4111 1111 1111 1111). For sandbox testing you must:

1. Log in to https://dashboard.razorpay.com → toggle **Test Mode** (top-right)
2. Settings → API Keys → Generate Test Key
3. Give me the two values:
```
PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxx
```

With test keys I can complete an end-to-end payment against Razorpay's sandbox
(test cards work, no money moves) and confirm every branch:
- Happy path → status confirmed
- Modal dismiss → button restores
- Signature tamper → red panel
- Duplicate verify → idempotent
- Amount change mid-flow → mismatch reject
- Buyer_id mismatch → 403
- Tab-close after Razorpay success → **prove the orphan bug in a controlled way**

## 8. Execution order (post-sandbox)

1. Provision test buyer via Supabase script (skip OTP)
2. Provision one same-day-pickup, one same-day-delivery, one pre-order listing
   on the active seller in `nyavzumoljcrmmwcdcuj`
3. Walk each module M1→M15 against localhost:4321 with screenshots
4. Per case: assert UI text, DB row state, and console+network cleanliness
5. Append actual results to QA-REPORT.md as an "Executed cases" table

Est time: 45 min with sandbox keys.
