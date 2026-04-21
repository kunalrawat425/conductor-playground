# Relifish — Feature Reference

Buyer and seller flows in parallel, module by module.
Last updated: 2026-04-21

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
- Add button: blue for regular order, purple for pre-order
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

```
scheduled_for set?
  → status = "scheduled"

open_days check: today in open_days? (default: all 7 days)
+ isSellerCurrentlyOpen (time-based: opens_at / closes_at)?
  → effectively open?
    → status = "pending"

not effectively open → try pre_order path:
  preorder_days set + today in it? (fallback: accepts_preorder bool)
  is_preorder_enabled on listing? (if listing_id present)
  preorder_cutoff_time not yet passed?
    → status = "pre_order"

none pass → 400 error with human-readable reason
```

### Inventory
- Regular orders: deduct `weight_avail` via `create_order_atomic` RPC (row-lock)
- **Pre-orders: inventory skipped** — `isPreorderCandidate` path bypasses stock validation
- Pre-order `paid_amount` = `total_price + delivery_fee` (reserved upfront at ordering price)

### Pricing
- Bundle validation: qty must be multiple of `bundle_size`
- Per-base-unit pricing: no bundle check
- Minimum order amount enforced server-side

---

## Module 6 — Checkout Flow (Buyer)

**Sheet:** `CheckoutSheet`

1. Buyer taps "Checkout" on cart bar
2. Login gate if not authenticated
3. Address picker if `order_type = delivery`
4. Order summary: items, subtotal, delivery fee, total
5. `POST /api/orders/create` → returns `order_id`
6. Redirect to `/v2/track/[order_id]`

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

### Stepper (4 steps)
```
Placed → Confirmed → Ready / On-the-way → Done
```
`pending_payment` and `payment_required` sit at step 1.

### Bill summary
Shows: subtotal, delivery fee, total.
Pre-order reconciled: also shows `final_price`, `paid_amount`, balance due or refund amount.

### Action blocks (contextual)
| Status | Action shown |
|---|---|
| `pending`, `pre_order`, `scheduled` | Cancel order |
| `confirmed`, `paid`, `ready_for_pickup` | Cut style + buyer notes form |
| `pending_payment` | Payment upload — amount due, file picker, preview, submit |
| `payment_required` | Balance payment — shows shortfall (final - paid), file picker |
| `completed`, `picked_up`, `cancelled`, `declined` | Re-order from same seller |

### Payment upload flow
1. Buyer sees amount due
2. File picker (image/*, max 5MB) + inline preview
3. Submit → `POST /api/orders/upload-payment` (multipart: order_id, buyer_id, file)
4. Uploads to `order-payments/{order_id}/{timestamp}.ext` (private Supabase Storage bucket)
5. **Storage path stored in DB** (not signed URL — avoids 24h expiry problem)
6. Status transitions: `pending → pending_payment`
7. Seller receives push notification

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
- Search by order ID or buyer phone
- CSV export

### Per-order status transitions (seller)
| Current status | Allowed transitions |
|---|---|
| `pending` | confirmed, declined |
| `pending_payment` | verify_payment → auto-confirmed |
| `pre_order` | confirmed, declined |
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
Adds items, pays upfront (paid_amount)  Opens dashboard
Uploads UPI screenshot                  Sees pre_order tab
status: pre_order                       Sets final_price via dashboard
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

**Key point:** Inventory is irrelevant for pre-orders. `weight_avail` is not checked or decremented. Pre-order reserves future catch only.

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

| Field | Purpose |
|---|---|
| `species` | Fish type; displayed capitalized everywhere in UI |
| `pricing_options[]` | Multi-tier: `price`, `unit`, `label`, `bundle_size`, `compare_at_price` |
| `weight_avail` | Current stock (kg or pieces) — irrelevant for pre-orders |
| `is_available` | Master visibility toggle |
| `is_preorder_enabled` | Per-listing pre-order gate (overrides seller-level `accepts_preorder`) |
| `preorder_min_qty` / `preorder_max_qty` | Quantity bounds for pre-orders on this listing |
| `buyer_daily_qty_limit` | Per-buyer daily cap (enforced in order create) |
| `oos_threshold` | Shows "Stock clearing soon" warning when `weight_avail <= oos_threshold` |
| `fish_size` | S / M / L badge |
| `photo_url` | Product image |

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
- Subject: `"{StatusLabel} — {Species}"`
- Includes: quantity, cut style, notes, total, delivery fee, scheduled_for

---

## Status State Machine

```
[buyer places order]
        ↓
  pending ──────────────────────────→ declined
  pre_order ────────────────────────→ declined
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
  pre_order → [seller set_final_price]
    → paid → reconcile_preorder_price RPC
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
| `refunded` — no automated UPI refund | Manual only; no tracking in app |
| Seller dashboard has no screenshot viewer | Seller can't see payment proof images (API exists, no UI) |
| `payment_required` — no shortcut payment from notifications | Buyer must navigate to track page |
| `preorder_cutoff_time` compared in server TZ | Assumes IST; use `AT TIME ZONE 'Asia/Kolkata'` for safety |
| `orders.seller_id` may be null for old orders | Ownership fallback denies; add column migration if needed |
| Signed URL re-generation endpoint missing | Needed when seller views stored screenshot paths in future dashboard |
