# Relifish V2 Design Notes

Last updated: 2026-04-23

This file documents the intended UX behavior and visual rules for buyer and seller order flows.

---

## 1) Product UX Principles

- Keep order state obvious at a glance.
- Use the same status language between buyer and seller surfaces.
- Prefer explicit reasons over disabled controls with no explanation.
- Treat time consistently in IST for display, filtering, and sorting.
- Keep payment + reconciliation visible end-to-end for pre-orders.

---

## 2) Order Flow UX Model

This section matches **live behaviour** in `/v2/track`, `/v2/track/[id]`, `/v2/dashboard/orders`, and checkout sheets on `/v2/seller/[id]` (not a simplified marketing diagram).

### Standard order (same-day)

1. **Placed (pay-first):** new listing-backed orders default to **`pending_payment`** — buyer pays listed total + delivery (if any) and **uploads UPI proof** before the seller can verify and confirm. **`scheduled`** orders also enter at `pending_payment` with a chosen slot. There is no separate `pending` accept/decline step before proof unless legacy data or a non-listing path still uses it.
2. **Confirmed:** after seller **Verify payment** → `confirmed` or `paid` — seller prepares fish; buyer sees green hero.
3. **Handoff:**
   - Pickup: `ready_for_pickup` → `picked_up` / `completed`
   - Delivery: `out_for_delivery` → `completed` (treated as delivered terminal in UI stepper)
4. **Terminal:** `declined`, `cancelled`, `refunded` where applicable.

Buyer stepper is **`resolveBuyerStepper`** (`src/lib/buyer-order-stepper.ts`):

- **`simple` (4 steps):** pickup `Placed / Confirmed / Ready / Picked up`; delivery `Placed / Confirmed / On the way / Delivered` — when the order never entered the UPI-proof path (no `pending_payment` / `payment_required`, no screenshots, no `payment_verified_at`).
- **`payment` (5 steps):** `Placed / Payment proof / Confirmed / Ready / …` — same-day (non-catch) whenever UPI proof or verify is in play (`pending_payment`, screenshots, `payment_verified_at`), **or** the order is already **`confirmed`+ with `paid_amount` > 0** (confirmation after payment) so the **Payment proof** column stays in the stepper; **no** “Price set” step.
- **`preorder` (5 steps):** catch flow including **`Price set`** when `isPreorderCatchFlow` is true.

So there is **one stepper component** and one set of rules — not “two unrelated steppers”; the extra row only appears when catch reconciliation exists.

### Catch pre-order (next-day advance UPI; five-step buyer UI)

**UI rule:** The five-step stepper (`Pre-ordered → Payment proof → Price set → …`) applies only when **`isPreorderCatchFlow`** is true (`src/lib/buyer-order-stepper.ts`): e.g. `pre_order`, `payment_required`, `pending_payment` with advance (`paid_amount > 0`), or post-pay states where `final_price` reconciles away from `total_price`. Do **not** treat “has `paid_amount` or `final_price`” alone as pre-order.

1. **Reserve + pay:** `pending_payment` — buyer pays listed advance and **uploads UPI proof**; seller **Verify & confirm** moves order to `confirmed` with `paid_amount` stamped.
2. **Morning reconciliation:** while `final_price` is still unset, seller only **sets final price** (dashboard). **No** `ready_for_pickup` / `out_for_delivery` until reconciliation completes.
3. **Reconcile outcomes** (RPC / seller action):
   - `final_price == paid_amount` → stays **`confirmed`**, fulfillment buttons unlock.
   - `final_price < paid_amount` → **`refunded`** path (seller refunds difference per policy).
   - `final_price > paid_amount` → **`payment_required`** — buyer pays balance and uploads proof again; seller verifies → **`confirmed`**, then fulfillment as usual.
4. **Fulfillment:** same as standard from `confirmed` onward (ready / out for delivery → done).

Pre-order stepper indices: `pending_payment` → proof on file advances the **Payment proof** step → `payment_required` → post-reconcile `confirmed` → fulfillment steps share the **last** label with standard orders (**Picked up** vs **Delivered** by `order_type`).

### Inventory

- **Pre-order:** no deduction when the buyer only places / pays advance (`pending_payment`); stock adjusts when the seller confirms, per DB triggers (e.g. confirm-only pre-order inventory).
- **Standard same-day (pay-first):** with `create_order_atomic` + deferred-stock migrations, inventory is **not** consumed at order creation while status is `pending_payment`; it commits when the seller confirms (and restores on cancel before confirm). UI surfaces out-of-stock / errors from API only.

---

## 3) Buyer UI Rules

### Checkout (seller page + shared components)

- **CheckoutSheet:** step 1 cart review → step 2 delivery method; if delivery, address row opens **`AddressPickerSheet`** above the sheet when `elevated` is used.
- **AddressPickerSheet + BottomSheet:** primary CTA **Deliver here →** must confirm selection and close; selection is stored per sheet id in `sessionStorage`, with **default address pre-selected** on load so the CTA works without an extra card tap.
- **SlotPickerSheet:** **Confirm slot** uses the same BottomSheet CTA mechanism (`v2ConfirmSlot(sheetId)`).

### Track list (`/v2/track`)

- Status badge must include `pending_payment`. When `payment_screenshot_urls` is non-empty and status is still `pending_payment`, prefer badge copy **Proof on file** (not “Payment pending” only).
- Stepper comes from **`resolveBuyerStepper`** (same on **list** `/v2/track` and **detail** `/v2/track/[id]`): variants **`simple` (4)**, **`payment` (5, no Price set)**, **`preorder` (5 + Price set)** — see §2.
- Quantity copy:
  - For piece-based bundle options (`bundle_size > 1`), show `N pack`.
  - Avoid raw "piece count" wording in cards.

### Order detail (`/v2/track/[id]`)

- `pending_payment` shows payment upload block and a **contextual** cancel: **Cancel pre-order** only if `isPreorderCatchFlow`; otherwise **Cancel order** (same-day or non-catch proof wait).
- **Hero status line:** for `pending_payment`, use **Payment proof submitted** when screenshots exist; otherwise **Upload payment proof**.
- **Next-day catch** purple education panel: only when `isPreorderCatchFlow` and the order is still in an applicable stage — do not show for same-day orders that happen to be `pending_payment` for UPI proof.
- Payment screenshot picker:
  - previews image inline
  - enforces max file size
  - shows upload state and existing proof
- Reconciled bill should show:
  - paid amount
  - final price
  - balance due or refund amount
- **Bill footnote** under totals: reflect combined state — e.g. *Payment proof submitted — seller will verify shortly* when paths exist without `paid_amount`; *Paid via UPI · screenshot on file* when both exist; *Payment proof pending* only when neither applies. Never `Pay at pickup`.

---

## 4) Seller UI Rules

### Dashboard orders (`/v2/dashboard/orders`)

- Tabs:
  - New: `pending`, `pending_payment`, `pre_order`, `scheduled`
  - In Progress: `confirmed`, `paid`, `payment_required`, `ready_for_pickup`, `out_for_delivery`
  - History: `completed`, `picked_up`, `declined`, `cancelled`, `refunded`
- Filters:
  - Date range
  - Type filter: `all / order / pre-order`
  - Search by order ID or buyer phone
- All card timestamps display in IST and include date + time.
- Card payment line uses neutral status copy (no `Pay at pickup` text).

#### Pre-order vs standard (seller)

- **Standard:** after **Verify payment** (UPI proof) → `confirmed` → seller marks ready / out for delivery.
- **Pre-order:** buyer may be on `pending_payment` with screenshots → seller verifies → `confirmed` with `paid_amount` set. Until **`final_price`** is set, the card shows only **reconciliation** (amount received, optional **View proof** for every path in `payment_screenshot_urls`, set final price). **No** ready-for-pickup / out-for-delivery until final price is reconciled.
- **Payment proof:** whenever `payment_screenshot_urls` is non-empty, show **View proof** (signed URL via seller API). This applies on `pending_payment`, on **confirmed/paid pre-order awaiting final price**, and on fulfillment cards if paths still exist for reference.

### Seller menu page (`/v2/seller/[id]`)

- Disabled add state must always include reason:
  - `Out of stock`
  - `Seller closed today`
  - fallback `Unavailable`
- If seller accepts pre-orders but listing is not configured, show hint to enable pre-order range.

---

## 5) Visual Language

- Active success states: green.
- Payment-required or proof-needed states: amber.
- Terminal failure states (declined/cancelled): red.
- Reconciliation/refund informational states: indigo/purple.

The same semantic colors should appear in buyer track hero, seller order badges, and action affordances.

### Buttons (consistency)

- Primary full-width CTAs (e.g. **Submit payment proof**, login verify): use `v2-btn v2-btn-primary v2-btn-md v2-btn-full` so padding and **min-height 44px** match other primary actions (`v2-btn-md`: `12px 24px`, 14px font).
- Secondary row actions: `v2-btn-sm` where space is tight (seller cards).

---

## 6) Copy Consistency

- Prefer `pack` for piece bundles where the user buys grouped units.
- Never show `Pay at pickup`; use the **bill footnote** rules in §3 (pending vs submitted vs paid + proof), or neutral payment status on seller cards.
- Keep action labels direct:
  - `Upload payment proof`
  - `Deliver here →` (address sheet primary)
  - `Verify & Confirm`
  - `Mark refund sent`
- Avoid ambiguous labels like "Unavailable" when a concrete reason can be shown.
- **Track list:** `Proof on file` badge is acceptable shorthand for `pending_payment` + uploaded screenshots.

---

## 7) Transactional email (all templates)

Implementation: **`src/lib/email-templates.ts`** (Resend sends HTML from these builders).

- **Shared chrome:** every message uses the same `shell()` — gradient Relifish header, white card body, footer links — so verify, order updates, and payment alerts **look like one product**, not one-off HTML.
- **Typography block:** `transactionIntro(eyebrow, title, subtitle)` (order emails use eyebrow **Order update**; verify uses **Account**; payment-proof seller alert uses **Action needed**).
- **Components reused everywhere:** `ctaButton`, `orderSummaryTable` / `summaryRow` where applicable, `calloutBox`, `footerSafetyText`.
- **Template inventory:** `orderEmailBuyer`, `orderEmailSeller` (status badge + line items), `verifyEmailTemplate` (magic link), `paymentProofReceivedEmailSeller` (after buyer uploads or replaces UPI screenshot).
- Fish names are title-cased in subjects and bodies (`Pomfret`, `Surmai`).
- Layout stays table-friendly and conservative spacing for major clients.

---

## 8) Web push (buyer + seller)

- **Buyer:** `sendBuyerOrderPush` (`src/lib/server/buyer-push.ts`) — on **order create** (`/api/orders/create`, cart create), **buyer payment upload**, **buyer cancel**, and **seller** updates via `/api/seller/orders`. Copy: `buyer-order-push-copy.ts`. Payload **`url`** is an **absolute** link from `site-origin.ts` (`PUBLIC_SITE_URL` / Vercel / `www.relifish.store` fallback): list **`…/v2/track`** or detail **`…/v2/track/{order_id}`** when `order_id` is passed.
- **Seller:** `POST /api/notify-seller` — **`new_order`** or **`kind: "payment_proof"`**. Payload **`url`** is absolute **`…/v2/dashboard/orders`** or **`…/v2/dashboard/orders?order={uuid}`** when `order_id` is sent (seller taps notification → orders page runs search + scroll highlight for that card).
- **Service worker:** `public/sw.js` resolves click targets with `new URL(…, self.location.origin)` so relative fallbacks still work; prefers server-sent absolute URLs.
- Subscriptions live on `buyers` / `sellers`; VAPID keys must be set server-side.
