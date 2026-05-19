# Relifish — Feature Reference

Buyer and seller flows in parallel, module by module.
Last updated: 2026-04-26

---

## Implementation Status (as of 2026-04-26)

| # | Feature | Status | Notes |
|---|---|---|---|
| M1 | Profile completion banner (guided onboarding) | ✅ Done | Inline banner on orders dashboard shows missing steps |
| M2 | Pre-order pricing per unit (min/max per kg/piece, JSONB) | ✅ Done | `listing-pricing.ts`, `listing-pricing-setup.ts`, migration 051 |
| M3 | No discount in pre-order mode | ✅ Done | `compare_at_price` suppressed in `seller/[id].astro` when `isListingPreorder` |
| M4 | `is_order_paused` — pause same-day, keep in pre-order | ✅ Done | DB column, `ListingForm.astro` checkbox, `seller/[id].astro` `hasStock` check |
| M5 | Buyer notes + cut style sent to API from pre-order wizard | ✅ Fixed | `preorder/[species].astro` POST body now includes `buyer_notes`, `cut_style` |
| M6 | Notes form locked at `ready_for_pickup` | ✅ Fixed | Read-only view shown; editable form removed at `ready_for_pickup` |
| M7 | Seller sees buyer notes / cut style in dashboard | ✅ Done | Order cards show cut style + notes |
| M8 | Seller refund screenshot upload UI | ✅ Done | Upload block shown for `declined` + `cancelled` orders with `paid_amount > 0` |
| M9 | Pre-order order total = `preorder_price_max × qty` | ✅ Done | `orders/create.ts` uses `chosen.preorder_price_max` |
| M10 | 7-day refund note visible to buyer | ✅ Done | Track page shows note on `refunded`, `declined`, `cancelled` statuses |
| M11 | Seller card offer label ("Same Day" / "Pre-order") | ✅ Done | `v2.astro` computes `offerLabel` and passes `offerBadge` to card |
| M12 | Store images | ❌ Missing | Needs DB migration + profile upload UI + SellerCard update |
| M13 | Location prompt immediately after login | ✅ Done | `LoginSheet.astro` sets `v2_prompt_location` flag; `AppHeader.astro` triggers picker |
| M14 | Payment screenshot replaces (not appends) | ✅ Done | `upload-payment.ts` line 107: `const updated = [path]` |
| M15 | Verify button disabled without proof | ✅ Done | `verifyBtnAttrs` disables when `!hasPaymentProof` |

**New gaps found in second audit:**
| # | Gap | Status |
|---|---|---|
| N1 | Pre-order menu unavailable message when no items have `is_preorder_enabled=true` | ✅ Done — `seller/[id].astro` `render()` now shows purple empty state |
| N2 | `is_order_paused` not in `ListingForm.astro` UI | ✅ Done — checkbox added to Display & limits section |
| N3 | Store images (`store_image_url`) | ❌ Missing — needs migration + upload |

**Migrations still to apply in Supabase SQL editor:**
- `036_order_notes_cut.sql` — adds `buyer_notes`, `cut_style` to orders
- `051_preorder_per_unit_pricing.sql` — per-unit preorder pricing, drops old global columns, adds `is_order_paused`

---

### Buyer & seller sales flow (at a glance)

| Flow | Buyer | Seller |
|---|---|---|
| **Same-day** | `/v2` → seller `/v2/seller/[id]` → cart → checkout → redirect **`/v2/track/[id]`**; order starts **`pending_payment`** → upload UPI proof → seller **Verify payment** → `confirmed` → fulfillment | `/v2/dashboard/orders` → **New** tab: **Verify payment** (not blind accept) → **In progress**: mark ready or out for delivery → complete |
| **Catch pre-order** (next-day inventory) | Order may start **`pending_payment`** with advance + screenshot; track uses **preorder** 5-step stepper when `isPreorderCatchFlow`; after verify, seller sets **final price** → RPC reconciles → buyer may owe balance (`payment_required`) | Same **New** tab for proof; **Verify payment** → **Set final price** when shown; **View proof** whenever `payment_screenshot_urls` is non-empty |
| **Same-day + UPI proof** | Same **5-step** buyer stepper as pre-order *except* no **Price set** row (`Placed → Payment proof → Confirmed → …`); whenever proof / verify / `pending_payment` applies | **Verify payment** same as above; no morning **final_price** RPC unless product adds it |

Shared rules: inventory for **pre-orders** and **pay-first same-day** commits on **seller confirm** (not at buyer place-order); payment screenshot paths live on `orders.payment_screenshot_urls` (private bucket `order-payments`, signed URLs at read time).

### Notifications (email + web push)

| Event | Buyer | Seller |
|---|---|---|
| Order created | **Push** `sendBuyerOrderPush` (`placed` / `pre_order` / `pending`) → opens **`/v2/track/{id}`** | **Push** `notify-seller` + `order_id` in body → **`/v2/dashboard/orders?order={id}`**; transactional **email** from create when configured |
| Buyer uploads / replaces UPI proof | **Push** `pending_payment` → same order **detail** URL | **Email** + **Push** `payment_proof` + `order_id` (same dashboard deep link) |
| Seller verifies / status change | **Push** (`confirmed`, `payment_verified`, transitions, cancel from buyer API, etc.) with **`order_id`** | — |
| Verify email (profile) | **Email** `verifyEmailTemplate` (magic link) | Same pattern if seller verifies email |

All HTML transactional email bodies share one design system in **`src/lib/email-templates.ts`** (`shell`, `transactionIntro`, CTAs). Push **`url`** fields use **absolute** URLs from **`src/lib/server/site-origin.ts`** so taps work from any origin; buyer order pushes prefer **`/v2/track/{order_id}`** when the id is known.

---

## Module 1 — Auth & Onboarding

| | Buyer | Seller |
|---|---|---|
| **Entry** | Phone OTP at `/v2/me` or any checkout gate | Phone OTP at `/v2/dashboard/login` |
| **Identity stored** | `localStorage: zepto_buyer_id`, `zepto_phone` | `localStorage: zepto_seller_id`, `zepto_seller_phone` |
| **Session check** | Client-side on every protected page | Client-side; redirects to `/v2/dashboard/login` |
| **Account state** | Auto-created on first OTP verify | Must be activated by admin (`is_active = true`) |
| **Email** | Optional, for order notifications | Optional, verified via magic link |

**Flow:**
1. User enters phone → OTP sent via Supabase Auth
2. OTP verified → `buyer_id` or `seller_id` stored in localStorage
3. Seller inactive → shows "Account pending activation" state

---

## Module 2 — Discovery (Buyer)

**Page:** `/v2`

### Category Strip
- Built client-side after listings load
- Species sorted by frequency across live listings
- "All" tab always first
- Filter by species: `?cat=pomfret` → filters listing grid
- URL: `/v2?cat=species_id` (not root `/`)

### Filters
- **Open now** toggle — hides sellers where `isSellerCurrentlyOpen = false`
- **Delivery** toggle — hides sellers without `has_delivery = true`
- Filters combine (AND logic)

### Seller Cards
- Status badge: exactly one of `Open Now` / `Pre-order` / `Closed` / `Pre-order only`
- Mutual exclusivity enforced in SSR
- Shows: species chips, rating, location, delivery tag, distance
- ⚠️ **[M11]** Left offer label ("Same Day" / "Pre-order") — `offer` prop exists on `SellerCard.astro` but never auto-populated from home page
- ⚠️ **[M12]** Store image — no `store_image_url` on sellers; card shows `🐟` emoji placeholder

### Search
- `/v2/search?q=term` — searches species name + Marathi name
- Results: listing cards with add-to-cart buttons

---

## Module 3 — Seller Listing Page

**Page:** `/v2/seller/[id]`

### Schedule Strip (buyer-visible)
```
🗓 Orders: Mon–Sat · 06:00–11:00
🌙 Pre-orders (next-day catch): Sun–Thu · cutoff 22:00
```

### State Banners
| Seller State | Banner shown to buyer |
|---|---|
| Open (time + day match) | None |
| Closed, pre-orders available today | Purple: "Pre-ordering for tomorrow's catch · Place before 22:00" |
| Fully closed (no orders, no pre-orders today) | Red: "Not available today" |

### Menu Grid
- Each listing card: species name (capitalized), photo or emoji, pricing tiers, size badge, stock warning
- Add button: primary brand blue (`+`) for both order and pre-order modes
- Multi-tier: each tier gets own counter
- Seller fully closed → grid greyed + `pointerEvents: none`

### Pre-order detection per item
- `isPreorderMode = true` (whole seller in pre-order mode today) → all items show purple
- `l.is_preorder_enabled && l.weight_avail <= 0` → individual item is pre-order

---

## Module 4 — Cart

**Component:** `RelifishCart` (global JS, localStorage-backed)

| Aspect | Detail |
|---|---|
| Storage | `localStorage: relifish_cart_v2` |
| Key structure | `listing_id` or `listing_id:pricing_option_id` |
| Multi-seller | Allowed; CartStackSheet shows per-seller grouped |
| Required fields | `listing_id`, `seller_id`, `seller_name`, `name`, `qty`, `price`, `qty_unit`, `pricing_option_id`, `pricing_label`, `added_at` |

Cart bar appears at bottom when non-empty. Shows item count + total.

CartStackSheet — if multiple sellers have items, shows each seller's subtotal with individual checkout buttons.

---

## Module 5 — Order Creation

**API:** `POST /api/orders/create`

### Status determination (server-side)

**Placement kind** (`orders.placement_kind`) is set from **seller shopping hours + order time only** (`src/lib/order-timing.ts`). Listing `is_preorder_enabled` and pickup **scheduling** do not decide order vs pre-order.

- **`same_day`** — seller is open (order day + `opens_at`–`closes_at` window) and line has stock → live price, stock checked at confirm.
- **`preorder`** — seller is closed but in the pre-order window (`preorder_days` + before `preorder_cutoff_time` IST) → pre-order price range, no stock decrement at create.
- **`pending_payment`** — pay-first for both kinds until UPI proof is uploaded.
- Pickup **scheduled slots** are disabled (API returns 400 if `scheduled_for` is sent).
- Seller **closed** outside the pre-order window → **400** with a readable reason.

Legacy rows may still have `status = pre_order` or missing `placement_kind`; UI infers from status when needed.

### Inventory
- **`create_order_atomic`** (with deferred-stock migrations): stock is **not** held at `pending_payment` for same-day pay-first; it commits on seller confirm and restores on cancel before confirm (row-lock RPC).
- **Pre-orders:** inventory skipped at creation — stock deducts when seller confirms.
- Pre-order `paid_amount` = `total_price + delivery_fee` (amount buyer pays and uploads proof for)

### Pricing
- Bundle validation: qty must be multiple of `bundle_size`
- Per-base-unit pricing: no bundle check
- Minimum order amount enforced server-side

---

## Module 6 — Checkout Flow (Buyer)

**Components:** `CheckoutSheet` (embedded on seller page and similar), `AddressPickerSheet`, `BottomSheet` (shared shell).

### Steps (typical)
1. Buyer taps checkout from cart bar / stack sheet → **LoginSheet** if not authenticated (`zepto_buyer_id` / phone).
2. **Step 1 — Cart review:** line items, subtotal, delivery row, **Next: Delivery →**.
3. **Step 2 — Delivery + place:**
   - **Pickup vs delivery** radio (delivery hidden if seller has no delivery).
   - If **delivery:** tap address card → **`AddressPickerSheet`** opens (elevated above checkout when nested). Saved addresses load from `GET /api/buyer/addresses`; primary CTA **Deliver here →** calls `v2ConfirmAddress(sheetId)` and dispatches `v2-address-confirmed` with `addressId`.
4. **Place order** → page listens for `v2-checkout-place-order` → `POST /api/orders/create` (or seller-cart variant where used) → `order_id`.
5. Redirect to **`/v2/track/[order_id]`** (or stay on seller page per product wiring).

### Address picker implementation notes
- Selection persisted in `sessionStorage` per sheet id (`{id}-selected`); default address seeded on load so CTA works without an extra tap.
- **Add new address** links to `/v2/me` address book.

---

## Module 7 — Order Tracking (Buyer)

**Page:** `/v2/track/[id]`

### Hero colour by status
| Status group | Colour |
|---|---|
| `pending`, `pre_order`, `scheduled` | Brand blue |
| `confirmed`, `paid`, `ready_for_pickup`, `out_for_delivery`, `picked_up`, `completed` | Green |
| `pending_payment`, `payment_required` | Amber |
| `declined`, `cancelled` | Red |
| `refunded` | Indigo |

### Stepper (`resolveBuyerStepper` in `src/lib/buyer-order-stepper.ts`)
One implementation, **three variants** — same “seller approves UPI” idea for normal orders, without inventing a catch **Price set** step when it does not apply.

| Variant | When | Pickup labels (delivery swaps Ready/Picked → On the way/Delivered) |
|---|---|---|
| **`simple`** | No UPI-proof journey on this order (`pending`→`confirmed` COD-style, no screenshots, not in `pending_payment` / `payment_required`, no `payment_verified_at`) | 4 steps: `Placed → Confirmed → Ready → Picked up` |
| **`payment`** | Same-day (or non-catch) **UPI / paid before confirm** — `pending_payment` / `payment_required`, or `payment_screenshot_urls`, or `payment_verified_at`, or **`paid_amount` > 0** while status is `confirmed`+ (so “Confirmed” is after payment); and **not** `isPreorderCatchFlow` | 5 steps: `Placed → Payment proof → Confirmed → Ready → Picked up` |
| **`preorder`** | Catch pre-order: `isPreorderCatchFlow` (e.g. `pre_order`, `payment_required`, advance on `pending_payment`, or post-pay reconcile where `final_price` ≠ `total_price`) | 5 steps: `Pre-ordered → Payment proof → Price set → Confirmed → …` |

Do **not** infer catch pre-order from `paid_amount` / `final_price` alone on fulfilled same-day orders.

- On the **preorder** path, `pending_payment` advances the **Payment proof** dot when `payment_screenshot_urls` is non-empty (same micro-step as before).

### Bill summary
Shows: subtotal, delivery fee, total.
Pre-order reconciled: also shows `final_price`, `paid_amount`, balance due or refund amount.
**Payment footnote** (under bill): uses proof + paid state — e.g. *Payment proof submitted — seller will verify shortly* when `payment_screenshot_urls` has paths but advance not recorded yet; *Paid via UPI · screenshot on file* when both exist; *Payment proof pending* only when neither applies. (No `Pay at pickup` wording.)

### Action blocks (contextual)
| Status | Action shown |
|---|---|
| `pending`, `pre_order`, `scheduled` | Cancel order |
| `pending_payment` | Payment upload + cancel — cancel label is **Cancel pre-order** only if `isPreorderCatchFlow`; otherwise **Cancel order** |
| `confirmed`, `paid` | Cut style + buyer notes form (editable) |
| `ready_for_pickup` | ⚠️ **[M6 — BUG]** Form currently still shows editable. **Should:** remove form, show read-only display of saved notes + "No changes after this point" note. |
| `payment_required` | Balance payment — shows shortfall (final - paid), file picker |
| `completed`, `picked_up`, `cancelled`, `declined` | Re-order (+ rating / refund UI as applicable) |

### Next-day catch callout (purple box)
Shown only when **`isPreorderCatchFlow(order)`** and the order is still in a pre-reconciliation / pre-fulfillment stage (not for same-day “upload proof” orders that are not catch pre-orders).

### Payment upload flow
1. Buyer sees amount due
2. File picker (image/*, max 5MB) + inline preview
3. Submit → `POST /api/orders/upload-payment` (multipart: order_id, buyer_id, file)
4. Uploads to `order-payments/{order_id}/{timestamp}.ext` (private Supabase Storage bucket)
5. **Storage path stored in DB** (not signed URL — avoids 24h expiry problem)
6. Status transitions:
   - same-day: order is usually **already** `pending_payment` at creation; upload attaches proof and clears `payment_verified_*` if re-uploading.
   - early legacy: `pending` / `pre_order` → `pending_payment` when first proof is uploaded.
7. Seller receives **branded email** (`paymentProofReceivedEmailSeller`) and **web push** (`/api/notify-seller` with `kind: "payment_proof"`).

### Realtime updates
- Supabase Realtime channel subscribes to `orders` row for this `order_id`
- Any DB UPDATE triggers `load()` re-render
- Fallback: poll every 30s
- Auto-unsubscribes on terminal statuses

---

## Module 8 — Seller Dashboard — Orders

**Page:** `/v2/dashboard/orders`

### Tabs
| Tab | Statuses |
|---|---|
| New | `pending`, `pending_payment`, `pre_order`, `scheduled` |
| In Progress | `confirmed`, `paid`, `payment_required`, `ready_for_pickup`, `out_for_delivery` |
| History | `completed`, `picked_up`, `cancelled`, `declined`, `refunded` |

### Filters
- Date range: today / 7d / 30d / all time
- Type filter: all / order / pre-order
- Search by order ID or buyer phone
- CSV export
- Order cards use neutral payment copy (`Payment status in order details`) instead of `Pay at pickup`

### Per-order status transitions (seller)
| Current status | Allowed transitions |
|---|---|
| `pending` | confirmed, declined |
| `pending_payment` | verify_payment → auto-confirmed |
| `pre_order` | confirmed, declined *(legacy/transition state only)* |
| `scheduled` | confirmed, declined |
| `confirmed` | ready_for_pickup, out_for_delivery, cancelled |
| `paid` | ready_for_pickup, out_for_delivery, cancelled |
| `payment_required` | confirmed, cancelled |
| `ready_for_pickup` | completed, cancelled |
| `out_for_delivery` | completed, cancelled |

### Verify payment (`action=verify_payment`)
- Stamps `payment_verified_at`, `payment_verified_by`
- **Auto-advances** `pending_payment → confirmed`
- Fires buyer push: "Order Confirmed"
- ⚠️ **[M15]** Verify button should be disabled when `payment_screenshot_urls` is empty — needs audit

### View buyer payment proof
- `GET /api/seller/payment-screenshot?order_id=&seller_id=&path=` returns a short-lived signed URL; path must be in `orders.payment_screenshot_urls`.
- Dashboard renders **View proof** for any non-empty `payment_screenshot_urls`, including **pre-orders on `confirmed`/`paid` while final price is still unset** (so sellers are not stuck without the screenshot after verify).

### Buyer notes / cut style
- ⚠️ **[M7]** Seller dashboard order cards do NOT yet display `buyer_notes` or `cut_style`. Fields exist in DB. Add to order detail/expand section.

### Refund screenshot upload
- API: `POST /api/seller/upload-refund` (stores to `order-payments/{order_id}/refund-*.ext`, updates `orders.refund_screenshot_path`)
- ⚠️ **[M8]** No UI button in dashboard. Seller cannot upload refund proof from the app. Add "Upload refund proof" button on `declined` / `cancelled` / `refunded` orders.

### Set final price for pre-orders (`action=set_final_price`)
- Calls `reconcile_preorder_price(order_id, final_price)` SQL RPC
- Compares `final_price` vs `paid_amount`:
  - Equal → `confirmed`
  - final < paid → `refunded` (seller owes buyer)
  - final > paid → `payment_required` (buyer owes balance)
- Fires buyer push with final_price

---

## Module 9 — Pre-order Flow (end to end)

```
BUYER (evening)                         SELLER (next morning)
─────────────────                       ──────────────────────
Sees purple banner on seller page       Goes to fish market
"Pre-ordering for tomorrow's catch"     Catches/weighs actual stock
Adds items, sees amount due             Opens dashboard
Uploads UPI screenshot                  Sees pending payment proof
status: pending_payment                 Verifies payment → confirmed
                                        Sets final_price via dashboard
                                        reconcile_preorder_price fires

           ┌──────────────────────────────────┐
           │ final == paid   → confirmed       │
           │ final < paid    → refunded        │ ← seller manually refunds UPI
           │ final > paid    → payment_req     │ ← buyer uploads balance payment
           └──────────────────────────────────┘

BUYER (payment_required case):
Sees amber banner on track page
"Additional payment needed: ₹X"
Uploads new UPI screenshot
Seller verifies → confirmed
```

**Key point:** Inventory flow for pre-orders:
- no deduction at pre-order creation or payment upload
- deduction happens only when seller confirms the order

---

## Module 10 — Seller Profile & Settings

**Page:** `/v2/dashboard/profile`

| Section | Fields |
|---|---|
| Business | `name`, `location_name`, `location`, `lat`/`lng` (GPS button) |
| Contact | `first_name`, `last_name`, `email` (magic link verify), `phone` (read-only) |
| Hours | `opens_at`, `closes_at` — cross-midnight ranges supported (e.g. 17:00–01:58) |
| Order days | `open_days` — pill toggles Mon–Sun, which days accept same-day orders |
| Pre-orders | `accepts_preorder` toggle → reveals `preorder_days` pills + `preorder_cutoff_time` |
| Delivery | `has_delivery`, `delivery_rad`, `delivery_fee_enabled`, `delivery_fee_amount`, `free_delivery_above` |
| Notifications | Push subscribe/unsubscribe |

### Day scheduling rules
```
open_days: ['mon','tue','wed','thu','fri','sat']
→ Sunday = day off, no same-day orders accepted

preorder_days: ['sun','mon','tue','wed','thu']
preorder_cutoff_time: '22:00'
→ Pre-orders accepted Sun–Thu before 10pm for next-day catch
→ Saturday pre-orders not accepted (seller's own day off from pre-orders)
```

---

## Module 11 — Listings Management (Seller)

**Pages:** `/v2/dashboard/listings`, `/v2/dashboard/listings/new`, `/v2/dashboard/listings/[id]`

| Field | Purpose | Status |
|---|---|---|
| `species` | Fish type; displayed capitalized everywhere in UI | ✅ |
| `pricing_options[]` | Multi-tier: `price`, `unit` (kg/piece), `label`, `bundle_size`, `compare_at_price` | ✅ |
| `weight_avail` | Current stock (kg or pieces) — irrelevant for pre-orders | ✅ |
| `is_available` | Master visibility toggle (hides from all menus) | ✅ |
| `is_preorder_enabled` | Per-listing pre-order gate (overrides seller-level `accepts_preorder`) | ✅ |
| `preorder_min_qty` / `preorder_max_qty` | Quantity bounds for pre-orders (not price bounds) | ✅ |
| `preorder_price_min` / `preorder_price_max` | **Global** pre-order price range — ⚠️ **[M2]** spec requires per-unit (kg and piece each get own range) | ⚠️ Partial |
| `buyer_daily_qty_limit` | Per-buyer daily cap (enforced in order create) | ✅ |
| `oos_threshold` | Shows "Stock clearing soon" warning when `weight_avail <= oos_threshold` | ✅ |
| `fish_size` | S / M / L badge | ✅ |
| `photo_url` | Product image | ✅ |
| `is_order_paused` | Pause listing for same-day orders only, keep in pre-order menu | ❌ **[M4]** Not yet added |

### Pre-order pricing rules (spec)
- Pre-order items show min/max price range per unit type (not a fixed price)
- **No discounts** (`compare_at_price` suppressed in pre-order mode) — **[M3]** not yet enforced
- Buyer pays max price at checkout; seller sets final price in morning → refund if lower
- 7-day refund SLA note shown to buyer at checkout — **[M10]** copy not yet present

---

## Module 12 — Notifications

### Buyer push
- Fires on every order status change by seller
- Message templated by status label ("Order Confirmed", "Ready for Pickup", etc.)
- Final price included in push for pre-order reconciliation events
- Never fails the order update if push throws (silent catch)

### Seller push (new orders)
- Fires when buyer places order
- Seller subscribes via profile page (browser Web Push permission)

### Email (via Resend)
- Fires on seller status transitions
- Sent to buyer (if email set and verified) AND seller
- Templates: `orderEmailBuyer` / `orderEmailSeller` from `src/lib/email-templates.ts`
- Subject: `"{StatusLabel} — {Species}"` with fish names title-cased
- Ecommerce-style transactional template: status badge, aligned summary rows, note callout, clear CTA
- Includes: quantity, cut style, notes, total, delivery fee, scheduled_for

---

## Status State Machine

```
[buyer places order]
        ↓
  pending ──────────────────────────→ declined
  pre_order (legacy) ─────────────────→ declined
  scheduled ────────────────────────→ declined
  pending_payment
    → [seller verify_payment] → confirmed
        ↓
  confirmed ───────────────────────→ cancelled
    ↓                 ↓
  ready_for_pickup   out_for_delivery
    ↓                 ↓
  completed (terminal)

  [pre-order reconcile path]
  confirmed(with paid_amount) → [seller set_final_price]
    → reconcile_preorder_price RPC
      → confirmed    (final == paid)
      → refunded     (final < paid)  ← manual UPI refund, no automation
      → payment_required (final > paid)
           → buyer uploads balance
           → pending_payment
           → seller verify_payment
           → confirmed
```

---

## Known Gaps

| Gap | Impact |
|---|---|
| `payment_required` — no shortcut payment from notifications | Buyer must navigate to track page |
| `orders.seller_id` may be null for old orders | Ownership fallback denies; add column migration if needed |
| **[M1]** No profile completion wizard | Sellers may skip name/email; no guided onboarding |
| **[M2]** Pre-order price range is global, not per-unit | Kg and piece can't have separate min/max ranges |
| **[M3]** `compare_at_price` not stripped in pre-order mode | Discounts may show on pre-order items (spec says none) |
| **[M4]** No `is_order_paused` — can't pause same-day while keeping pre-order | Seller must hide listing entirely to stop same-day |
| **[M5]** `buyer_notes` + `cut_style` not sent to API from pre-order wizard | Buyer preferences silently lost |
| **[M6]** Notes form editable at `ready_for_pickup` | Buyer can change notes after seller starts prep |
| **[M7]** Seller can't see `buyer_notes`/`cut_style` in dashboard | Seller doesn't know cut preference |
| **[M8]** No UI to upload refund screenshot (API exists) | Seller can't prove refund sent |
| **[M9]** Pre-order checkout max-price unverified | May use listing price instead of `preorder_price_max` |
| **[M10]** 7-day refund note absent at pre-order checkout | Buyer unaware of refund policy before placing |
| **[M11]** Seller card "Same Day" / "Pre-order" left label never set | Card offer label always empty |
| **[M12]** No store images on sellers table or card | Card shows fish emoji instead |
| **[M13]** Location not prompted at login | New buyer sees empty home page |
| **[M14]** Payment screenshot may append instead of replace | Spec allows only 1 screenshot |
| **[M15]** Verify button may not be disabled without proof | Seller could verify before buyer uploads |

### Resolved gaps (as of 2026-04-21)
| Gap | Resolution |
|---|---|
| `refunded` — no tracking | Seller marks refund sent via dashboard with optional UPI screenshot; buyer sees amount + 7-day SLA + proof link |
| Seller dashboard has no screenshot viewer | `GET /api/seller/payment-screenshot` generates signed URL; "View proof" button per screenshot on `pending_payment` orders |
| Signed URL re-generation endpoint missing | Both `/api/seller/payment-screenshot` and `/api/orders/refund-screenshot` generate fresh 1h signed URLs from stored paths |
| `preorder_cutoff_time` compared in server TZ | Fixed: uses IST UTC+5:30 offset arithmetic, no host-TZ dependency |

### Resolved gaps (as of 2026-04-23)
| Gap | Resolution |
|---|---|
| Bottom sheet primary CTA (e.g. **Deliver here →**) did nothing | `BottomSheet` wires `button[data-sheet-action]` → `window[action](sheetId)` once globally; address + slot confirm pass sheet id |
| Same-day orders showed pre-order stepper (Price set / Payment proof labels) | `isPreorderCatchFlow()` replaces broad `paid_amount \|\| final_price` heuristic |
| Bill said “Payment proof pending” when proof already on order | Footnote + hero status copy consider `payment_screenshot_urls`; track list badge **Proof on file** for `pending_payment` + proof |
