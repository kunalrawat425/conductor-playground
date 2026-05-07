# Relifish — Product Requirements (Source of Truth)

**Last updated:** 2026-04-26  
**Platform:** Fish marketplace. Sellers are fish vendors; buyers are end consumers.  
**Stack:** Astro SSR · Supabase (Postgres + Realtime + Storage) · UPI payments (manual proof) · Web Push + Resend email  
**Timezone:** All scheduling logic in IST (UTC+5:30).

---

## 1. Core Mental Model

Two distinct order types share the same order table and most of the same UI, but have different pricing, inventory, and timing rules:

| | Same-day order | Catch pre-order |
|---|---|---|
| **When available** | Seller open days + within open hours | Seller's preorder days + before preorder cutoff |
| **Price** | Fixed per listing tier; deals/discounts allowed | Min–max range per unit type; **no discounts** |
| **Inventory** | Deducted on seller confirm | Not deducted at order time; deducted on confirm |
| **Buyer pays** | Full price upfront (UPI proof) | Max price upfront; seller reconciles next morning |
| **Seller action** | Verify payment → ready/deliver | Verify payment → set final price → ready/deliver |
| **Refund** | On cancel/decline if paid | If final price < max paid |

---

## 2. Seller Side

### 2.1 Profile & Business Setup

Sellers complete these sections at `/v2/dashboard/profile`. A profile completion banner on the orders dashboard shows incomplete steps.

| Section | Fields | Required |
|---|---|---|
| Business | `name`, `location_name`, `location` (text), `lat`/`lng` (GPS) | name, location |
| Contact | `first_name`, `last_name`, `email` (magic-link verify), `phone` (read-only) | — |
| Store hours | `opens_at`, `closes_at` (HH:MM, cross-midnight supported) | Yes |
| Order days | `open_days[]` — Mon–Sun pill toggles | Yes |
| Pre-orders | `accepts_preorder` toggle → `preorder_days[]` + `preorder_cutoff_time` (default: 22:00 IST EOD) | If using pre-orders |
| Delivery | `has_delivery`, `delivery_rad` (km), `delivery_fee_amount`, `free_delivery_above` | If offering delivery |
| Min order | `min_order_amount` — enforced at checkout | — |
| Notifications | Web Push subscribe/unsubscribe | — |

**Onboarding completion steps** (shown as a checklist banner):
1. Business name set (not "New Seller")
2. Location set (location_name or lat/lng)
3. Store hours set (opens_at + closes_at)
4. Email verified

---

### 2.2 Listings

One listing = one fish species in one unit type (kg or piece). Sellers create separate listings for kg and piece.

**Fields:**

| Field | Type | Description |
|---|---|---|
| `species` | text | Fish type; free text; displayed capitalized |
| `fish_size` | enum (small/medium/large) | Optional size badge |
| `photo_url` | text | Product photo (max 5MB) |
| `pricing_options[]` | JSONB array | See pricing model below |
| `weight_avail` | numeric | Current stock in the listing's base unit |
| `is_available` | bool | Master toggle — hides from all menus when false |
| `is_preorder_enabled` | bool | Enables pre-order mode for this listing |
| `is_order_paused` | bool | Hides from same-day menu but keeps in pre-order menu |
| `buyer_daily_qty_limit` | numeric | Max units per buyer per day (same-day only) |
| `oos_threshold` | numeric | Shows "Stock clearing soon" when stock ≤ this value |

**Pricing options (per tier in `pricing_options[]`):**

| Field | Description |
|---|---|
| `id` | UUID per tier |
| `unit` | `kg` or `piece` |
| `label` | Display label (e.g. "1 kg", "3 pieces") |
| `bundle_size` | Minimum purchase unit (e.g. 3 means sold in packs of 3) |
| `price` | Per-unit price for same-day orders |
| `compare_at_price` | Original price for showing discounts (same-day only) |
| `preorder_price_min` | Min price for this tier's pre-order range |
| `preorder_price_max` | Max price for this tier's pre-order range |

**Listing visibility rules:**

```
Same-day mode:    is_available = true  AND  is_order_paused = false
Pre-order mode:   is_preorder_enabled = true
                  (pricing_options[n].preorder_price_min/max set per tier)
Hidden:           is_available = false
```

**Pre-order pricing rules:**
- Each pricing tier (per unit type) has its own `preorder_price_min` and `preorder_price_max`
- No discounts (`compare_at_price`) shown in pre-order mode
- Buyer pays `preorder_price_max × qty` at order time
- Seller sets actual final price next morning after the catch
- If final < paid → refund within 7 working days
- If final > paid → buyer pays the difference
- If final == paid → auto-confirmed

---

### 2.3 Seller Store Timing Logic

**Same-day open condition:**
```
today ∈ open_days  AND  current IST time ∈ [opens_at, closes_at]
```

**Pre-order open condition:**
```
today ∈ preorder_days  AND  current IST time < preorder_cutoff_time
```

**Store states visible to buyers:**

| State | Condition | Buyer sees |
|---|---|---|
| Open | open day + within hours | Regular menu, prices, add buttons |
| Pre-order | not open + pre-order day + before cutoff | Purple banner, pre-order items only, min–max ranges |
| Pre-order menu unavailable | pre-order mode + zero items have `is_preorder_enabled=true` | "Pre-order menu unavailable" empty state |
| Closed | neither open nor pre-order today | Red banner, greyed menu, no add buttons |

---

### 2.4 Orders Dashboard

**Page:** `/v2/dashboard/orders`

**Tabs:**

| Tab | Statuses |
|---|---|
| New | `pending`, `pending_payment`, `pre_order`, `scheduled` |
| In Progress | `confirmed`, `paid`, `payment_required`, `ready_for_pickup`, `out_for_delivery` |
| History | `completed`, `picked_up`, `cancelled`, `declined`, `refunded` |

**Seller actions per status:**

| Status | Allowed actions |
|---|---|
| `pending` | Decline |
| `pending_payment` | View payment proof · Verify payment (disabled until proof uploaded) · Decline |
| `confirmed` / `paid` | View proof · Set final price (pre-orders only) · Mark ready for pickup · Mark out for delivery · Cancel |
| `ready_for_pickup` | Mark picked up · Cancel |
| `out_for_delivery` | Mark delivered · Cancel |
| `declined` / `cancelled` (with paid_amount > 0) | Upload refund screenshot · Add UTR note · Mark refund sent |

**Verify payment:**
- Button disabled when `payment_screenshot_urls` is empty
- On verify: stamps `payment_verified_at` + `payment_verified_by` → auto-advances to `confirmed`
- Fires buyer push notification

**Set final price (pre-orders):**
- Input shown when `confirmed`/`paid` AND `final_price` is null AND `paid_amount > 0`
- Calls `reconcile_preorder_price(order_id, final_price)` RPC
- RPC outcomes: `confirmed` / `refunded` / `payment_required`

**Buyer info displayed on order cards:**
- Cut style (`cut_style`) with mapping: whole / cleaned / cut
- Buyer notes (`buyer_notes`)
- Order type badge (Order / Pre-order)
- Delivery mode (Pickup / Delivery)

---

### 2.5 Notifications (Seller)

| Event | Channel |
|---|---|
| New order placed | Web push + email |
| Buyer uploads payment screenshot | Web push + email |
| Order cancelled by buyer | Web push |

---

## 3. Buyer Side

### 3.1 Discovery — Home Page `/v2`

**Location gate:**
- Buyer must set location before seeing listings
- If no location: "not serviceable" prompt
- After first login: location picker auto-opens if `v2_buyer_location` not set in localStorage

**Fish category strip (priority order):**
Surmai → Pomfret → Crabs → Bangda → (rest sorted by listing frequency)

**Filters:**
- All / Open Now / Pre-order
- Pickup / Delivery
- Top rated

**Seller card shows:**
- Left badge: "Same-day catch" or "Pre-order only" or "Pre-order available" or "Closed today"
- Store image (placeholder emoji if not set)
- Store name + rating
- Location name + distance
- Store status (open/closed/pre-order based on day + time)
- Delivery mode (Pickup only / Delivery)
- Top 4 fish listings by name + "X more" box

---

### 3.2 Seller Store Page `/v2/seller/[id]`

**Header:** Seller name, location, rating, WhatsApp/phone button, store status, schedule strip

**Schedule strip:**
```
🗓 Orders: Mon–Sat · 06:00–11:00
🌙 Pre-orders (next-day catch): Sun–Thu · cutoff 22:00
```

**Menu:**
- Same-day mode: in-stock items with price tiers, deal badges, add buttons
- Pre-order mode: pre-order enabled items with min–max range per tier (no discounts), purple styling
- Closed: all items greyed, "Not available today" banner

**Item card shows:**
- Photo or species emoji
- Name (capitalized), size badge
- Pre-order range per tier: `₹min–₹max/kg` or `₹min–₹max/pc`
- Stock warning ("Stock clearing soon") when near `oos_threshold`
- Discount badge (same-day only, not pre-order)
- Per-tier counters (+/−) per pricing option

---

### 3.3 Cart

- Stored in `localStorage: relifish_cart_v2`
- One cart across sellers (CartStackSheet groups by seller)
- Cart bar at bottom: item count + total
- CartStackSheet: per-seller subtotal + individual checkout buttons

---

### 3.4 Checkout Flow

1. Tap checkout → login gate (OTP) if not authenticated
2. Cart review: line items, subtotal, delivery fee
3. Choose delivery method: Pickup (default) or Delivery (if seller supports)
4. If delivery: address picker → saved addresses or add new
5. Place order → `POST /api/orders/create` → redirect to `/v2/track/[id]`

**Delivery fee:** applied if `has_delivery = true` and method = delivery; waived if order ≥ `free_delivery_above`

---

### 3.5 Order Tracking `/v2/track/[id]`

**Stepper variants:**

| Variant | Triggers | Steps |
|---|---|---|
| `simple` | No UPI proof journey, no `pending_payment` | Placed → Confirmed → Ready → Picked up |
| `payment` | Has `payment_screenshot_urls` or `payment_verified_at` or `paid_amount > 0`, not pre-order catch | Placed → Payment proof → Confirmed → Ready → Picked up |
| `preorder` | `isPreorderCatchFlow` (pre_order status, or `final_price ≠ total_price`) | Pre-ordered → Payment proof → Price set → Confirmed → Ready → Picked up |

**Action blocks per status:**

| Status | Buyer action |
|---|---|
| `pending` / `pre_order` / `scheduled` | Cancel order |
| `pending_payment` | Upload / replace UPI screenshot + cancel |
| `confirmed` / `paid` | Add cut style + buyer notes (editable) |
| `ready_for_pickup` | Read-only: shows saved cut style + notes, "No changes after this point" |
| `payment_required` | Upload balance payment screenshot |
| `refunded` | View refund amount, 7-day SLA note, seller refund screenshot button |
| `declined` / `cancelled` (paid) | View refund note, 7-day SLA, seller refund screenshot button |
| `completed` / `picked_up` | Rate order · Re-order |

**Payment upload:**
- Single screenshot only (replaces previous)
- Max 5MB image
- Stored in Supabase private bucket `order-payments/{order_id}/{timestamp}.ext`
- Path stored in DB, signed URLs generated on read (1h expiry)
- Seller notified via push + email on upload

**Realtime:** Supabase Realtime channel on `orders` row; 30s poll fallback; unsubscribes on terminal status.

---

### 3.6 Buyer Profile `/v2/me`

| Section | Fields |
|---|---|
| Profile | `first_name`, `last_name`, `email` (optional) |
| Addresses | Address book CRUD — label, flat, building, landmark, location, lat/lng |
| Orders | Order history list with status badges → taps to `/v2/track/[id]` |
| Notifications | Web Push subscribe/unsubscribe |
| Preferences | Night mode toggle |
| Account | Logout |

---

## 4. Pre-order Flow (End to End)

```
EVENING — Buyer                         MORNING — Seller
────────────────                        ──────────────────
Opens seller page in pre-order mode     Goes to fish market / gets catch
Sees purple banner + pre-order items    Weighs actual stock
Each item shows: ₹min–₹max per unit     Opens seller dashboard
No discounts shown                      Sees "New" tab orders
Adds to cart (qty, tier)                Finds pre-order(s) from previous night
Checkout → UPI screenshot               Clicks "Verify payment" → confirmed
Order created at preorder_price_max × qty
status: pending_payment                 Inputs final price → "Set price"
7-day refund note shown                 reconcile_preorder_price RPC fires:

                                        ┌─ final == paid   → confirmed
                                        ├─ final < paid    → refunded
                                        │    seller uploads refund screenshot
                                        │    buyer sees refund proof + 7d note
                                        └─ final > paid    → payment_required
                                             buyer uploads balance payment
                                             seller verifies → confirmed

After confirmed:                        After confirmed:
Buyer sees confirmed status             Seller marks Ready for pickup
Can set cut style + notes               (or Out for delivery)
                                        Cut style + notes visible on card
On ready_for_pickup:                    On picked_up:
Buyer sees read-only prefs              Order moves to History tab
Can't edit cut/notes anymore            Status: completed (terminal)
```

---

## 5. Order State Machine

```
[buyer places order]
        ↓
  pending_payment ─[no proof yet]─────────────────────→ (waiting)
        │ [buyer uploads proof]
        ↓
  pending_payment (proof on file)
        │ [seller verify_payment]
        ↓
  confirmed ──────────────────────────────────────────→ cancelled
        │                      │
        │ [pre-order only]      │ [same-day or pre-order post-reconcile]
        │ seller set_final_price│
        ↓                      │
  refunded ←─ final < paid     │
  payment_required ← final > paid → buyer pays → pending_payment → confirmed
  confirmed ← final == paid    │
                               ↓
                    ready_for_pickup ──→ completed (terminal)
                    out_for_delivery ──→ completed (terminal)

  [any stage]
  declined (terminal — seller rejects; refund flow if paid)
  cancelled (terminal — buyer or seller cancels; refund flow if paid)
```

**Terminal statuses:** `completed`, `picked_up`, `cancelled`, `declined`, `refunded`

---

## 6. Notifications

| Event | Buyer receives | Seller receives |
|---|---|---|
| Order placed | Push → `/v2/track/{id}` | Push + email → `/v2/dashboard/orders?order={id}` |
| Buyer uploads proof | Push: proof submitted | Push + email: payment proof received |
| Seller verifies payment | Push: order confirmed | — |
| Seller marks ready | Push: ready for pickup | — |
| Seller marks delivered | Push: completed | — |
| Seller sets final price | Push: final price + next step | — |
| Order declined | Push: declined | — |
| Order cancelled | Push: cancelled | — |
| Pre-order: balance due | Push: payment_required + amount | — |
| Refund initiated | Push: refunded + amount | — |

**Email:** Resend · sent to buyer (if email verified) and seller on all status changes  
**Push:** Web Push · absolute URLs · buyer uses `/v2/track/{id}` · seller uses dashboard deep link

---

## 7. Data Model (Key Tables)

### `sellers`
```
id, name, phone, email, email_verified
first_name, last_name
location_name, location, lat, lng
opens_at, closes_at, open_days[]
accepts_preorder, preorder_days[], preorder_cutoff_time
has_delivery, delivery_rad, delivery_fee_amount, free_delivery_above
min_order_amount
rating_avg, is_active
```

### `fish_listings`
```
id, seller_id, species, fish_size
pricing_options[]           ← JSONB: [{id, unit, label, bundle_size, price,
                                        compare_at_price,
                                        preorder_price_min, preorder_price_max}]
weight_avail, is_available
is_preorder_enabled, is_order_paused
buyer_daily_qty_limit, oos_threshold
photo_url, listed_date
```

### `orders`
```
id, listing_id, seller_id, buyer_id, buyer_phone
species, quantity, quantity_unit, pricing_option_id, pricing_label
order_type (pickup/delivery), status
total_price, delivery_fee, paid_amount, final_price
payment_screenshot_urls[]   ← single-screenshot policy (replace, not append)
payment_verified_at, payment_verified_by
refund_screenshot_path, refund_sent_at, refund_note
buyer_notes, cut_style
schedule_slot_id, scheduled_for
buyer_addr, created_at
```

### `buyers`
```
id, phone, email, email_verified
first_name, last_name
push_subscription
```

---

## 8. Implementation Status

### ✅ Fully implemented

- Auth (OTP → buyer/seller session in localStorage)
- Seller profile + all settings fields
- Listing CRUD with full pricing model (tiers, bundles, deals)
- Pre-order pricing per unit (min/max in `pricing_options` JSONB, migration 051)
- `is_order_paused` — DB column + ListingForm checkbox + seller menu filter
- Seller store page: open/preorder/closed state + per-tier pricing display + per-tier pre-order ranges
- No discount in pre-order mode
- Pre-order menu "unavailable" empty state
- Cart (localStorage, multi-seller, CartStackSheet)
- Checkout (pickup + delivery, address picker, delivery fee)
- Order creation (`create_order_atomic` RPC, inventory deferred to confirm)
- Pre-order total = `preorder_price_max × qty`
- Payment screenshot upload (single-proof, replace policy)
- Verify payment (disabled until proof uploaded)
- Buyer order tracking with 3 stepper variants (simple / payment / preorder)
- Notes + cut style form (editable at `confirmed`/`paid`, read-only at `ready_for_pickup`)
- Buyer notes + cut style from pre-order wizard
- Seller dashboard sees buyer notes + cut style on cards
- Set final price → reconcile RPC → `confirmed` / `refunded` / `payment_required`
- Refund UI for seller on `declined` + `cancelled` (upload screenshot, UTR note, mark sent)
- Buyer sees seller refund screenshot + 7-day note on `declined` / `cancelled` / `refunded`
- Seller card offer labels ("Same-day catch" / "Pre-order available" / etc.)
- Location prompt auto-opens after first buyer login
- Buyer profile (edit name/email, address book, order history, night mode, logout)
- Profile completion banner on seller dashboard
- Web push (buyer + seller) + Resend email on all key events
- Realtime order updates on track page

### ❌ Not yet implemented

| Gap | Notes |
|---|---|
| **Store images** | `store_image_url` column missing from `sellers`; card shows emoji placeholder. Needs: migration + profile photo upload + SellerCard update. |

### ⏳ Pending migrations (apply in Supabase SQL editor)

| File | What it does |
|---|---|
| `036_order_notes_cut.sql` | Adds `buyer_notes`, `cut_style` columns to `orders` |
| `051_preorder_per_unit_pricing.sql` | Migrates global `preorder_price_min/max` into `pricing_options[0]` JSONB; drops old global columns + `preorder_min_qty/max_qty`; adds `is_order_paused` column |

---

## 9. File Reference

| Area | Key files |
|---|---|
| Buyer home | `src/pages/v2.astro` |
| Seller store page | `src/pages/v2/seller/[id].astro` |
| Order tracking | `src/pages/v2/track/[id].astro` |
| Pre-order wizard | `src/pages/v2/preorder/[species].astro` |
| Buyer profile | `src/pages/v2/me.astro` |
| Seller orders dashboard | `src/pages/v2/dashboard/orders/index.astro` |
| Seller profile | `src/pages/v2/dashboard/profile.astro` |
| Listing form (new + edit) | `src/components/ListingForm.astro`, `src/pages/v2/dashboard/listings/` |
| Pricing logic | `src/lib/listing-pricing.ts`, `src/lib/listing-pricing-setup.ts` |
| Supabase types | `src/lib/supabase.ts` |
| Order create API | `src/pages/api/orders/create.ts` |
| Payment upload | `src/pages/api/orders/upload-payment.ts` |
| Order detail API | `src/pages/api/orders/detail.ts` |
| Refund screenshot | `src/pages/api/seller/upload-refund.ts`, `src/pages/api/orders/refund-screenshot.ts` |
| Buyer stepper | `src/lib/buyer-order-stepper.ts` |
| Email templates | `src/lib/email-templates.ts` |
| Push notifications | `src/lib/server/buyer-push.ts`, `src/pages/api/notify-seller.ts` |
| Search | `src/pages/api/search.ts` |
| Migrations | `supabase/migrations/` |
