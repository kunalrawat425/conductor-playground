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
- **Fish names:** All fish names are title-cased in subjects and bodies (e.g. `Pomfret`, `Surmai`) via the `capitalizeFishName` helper.
- **Layout & Spacing:** Layout stays table-friendly and utilizes conservative spacing for major email client compatibility (using nested tables, margins, and inline styles).

### Template, Trigger & Subject Matrix

| Template Function | Trigger Event | Recipient | Subject Line Pattern |
| :--- | :--- | :--- | :--- |
| **`verifyEmailTemplate`** | Magic link request from profile page | Buyer or Seller | `Verify your email — Relifish` |
| **`orderEmailBuyer`** | Order created (`pending_payment` / `pre_order`) | Buyer | `${statusLabel} — ${species}` (e.g. `Order placed — complete payment to confirm — Pomfret`) |
| **`orderEmailSeller`** | Order created (`pending_payment` / `pre_order`) | Seller | `New order: ${species}` or `New pre-order: ${species}` |
| **`proofUploadedEmailBuyer`**| UPI payment screenshot uploaded by buyer | Buyer | `Proof received — awaiting verification · ${species}` |
| **`paymentProofReceivedEmailSeller`**| UPI payment screenshot uploaded by buyer | Seller | `Payment screenshot received — ${species}` |
| **`paymentVerifiedEmailBuyer`** | Seller verifies payment in dashboard | Buyer | `Payment verified — ${species}` |
| **`paymentVerifiedEmailSeller`**| Seller verifies payment in dashboard | Seller | `Payment verified — ${species}` |
| **`refundSentEmailBuyer`** | Seller marks pre-order refund as sent | Buyer | `Refund sent — ${species}` |
| **`refundSentEmailSeller`** | Seller marks pre-order refund as sent | Seller | `Refund marked sent — ${species}` |
| **`razorpayReceiptEmail`** | Razorpay checkout session payment verified | Buyer | `Payment confirmed — your Relifish order is set ✓` |
| **`orderEmailSeller`** (Razorpay auto-confirmed) | Razorpay checkout session payment verified | Seller | `New order paid: ${species}` |
| **`orderEmailBuyer`** (Status update) | Seller updates order status in dashboard | Buyer | `${statusLabel} — ${species}` (e.g. `Out for Delivery — Pomfret`) |
| **`orderEmailSeller`** (Status update) | Seller updates order status in dashboard | Seller | `Order Update: ${statusLabel} — ${species}` |


---

## 8) Web push (buyer + seller)

- **Buyer:** `sendBuyerOrderPush` (`src/lib/server/buyer-push.ts`) — on **order create** (`/api/orders/create`, cart create), **buyer payment upload**, **buyer cancel**, and **seller** updates via `/api/seller/orders`. Copy: `buyer-order-push-copy.ts`. Payload **`url`** is an **absolute** link from `site-origin.ts` (`PUBLIC_SITE_URL` / Vercel / `www.relifish.store` fallback): list **`…/v2/track`** or detail **`…/v2/track/{order_id}`** when `order_id` is passed.
- **Seller:** `POST /api/notify-seller` — **`new_order`** or **`kind: "payment_proof"`**. Payload **`url`** is absolute **`…/v2/dashboard/orders`** or **`…/v2/dashboard/orders?order={uuid}`** when `order_id` is sent (seller taps notification → orders page runs search + scroll highlight for that card).
- **Service worker:** `public/sw.js` resolves click targets with `new URL(…, self.location.origin)` so relative fallbacks still work; prefers server-sent absolute URLs.
- Subscriptions live on `buyers` / `sellers`; VAPID keys must be set server-side.

---

## 9) Mobile apps (mobile/)

Two Android/iOS apps from one Expo codebase (`APP_VARIANT` in `mobile/app.config.ts`): **Relifish** (buyers, `com.relifish.app`) and **Relifish Partner** (sellers, `com.relifish.partner`). The website is the single source of truth for design and business rules.

- **Tokens:** `npm run tokens` (in `mobile/`) generates `mobile/src/theme/tokens.ts` from `src/styles/tokens.css` (light + dark) and `festive.css`. Never hard-code a colour in a screen; the one exception is the site's own literal for the BEST VALUE ribbon (`#16A34A`), kept in `mobile/src/ui/index.tsx`.
- **Type:** Inter at the site's weights. React Native needs one family per weight, so `Text` in `mobile/src/ui` picks `Inter_<weight>` from `fontWeight`.
- **Components** (`mobile/src/ui/index.tsx`) mirror the site classes: `Button` (`.v2-btn` sm/md/lg), `Card`, `Badge` (`.v2-item-cut`, `.v2-pop`, `.v2-off`, `.v2-oc-badge`), `PriceRow`, `AddButton` (`.v2-item-add`), `TierRow` (`.v2-item-tier`), `ItemCard` (`.v2-item-card`), `CartBar` (`.v2-cart-bubble`), `HeaderBackground` (`.v2-header`; Diwali gradient on buyer screens while `festiveFor()` says so, plain blue in the seller app like `/dashboard`).
- **Business rules** come straight from `src/lib` (Metro `watchFolders`): pricing, timing, delivery slots, species names, pay on delivery. Modules the app imports must not use `import.meta` (Hermes can't parse it); see `src/lib/festive-window.ts`.
- **Parity check:** `/tmp/pw/parity.js` (buyer) and `/tmp/pw/partner.js` (seller) compare computed styles and same-content crops of the app's web build against stage, writing `.context/parity/REPORT.md`.
- **Push:** the apps save `{ endpoint: "https://exp.host/--/api/v2/push/send", expo: "ExponentPushToken[…]" }` as the push subscription; `loadWebPush()` sends those through Expo (see §8), so every web-push sender reaches the app.
- **Festive theme without a store release:** the apps call `GET /api/theme` (`{ festive: "diwali" | null }`, from `festiveTheme()`) at launch, keep the last answer in secure storage, and fall back to the same date window (`festiveFor`) offline. Light/dark follows the phone.
- **Partner new-order ring:** an Android channel `orders` (MAX importance, bundled `new_order.wav`, long vibration, public on the lock screen, bypasses Do Not Disturb where allowed); seller pushes for `new_order` / `payment_confirmed` / `pay_on_delivery` use it. With the app open, a 20 s check (plus every push and every return to the app) shows a full-screen "New order ₹X · Accept / View" sheet and loops the ringtone until the seller taps, the order is handled elsewhere, or 60 s pass. iOS plays the same sound; ringing through silent mode needs Apple's critical-alerts entitlement, which we don't have.

---

## 10) Component library (web ↔ app)

Every UI component the website uses, its React Native twin in `mobile/src/ui` (same name, same tokens, Inter at the same weights) and its rules. Live examples with the site's real CSS: `/design-system/live.html` (all) or `/design-system/live.html?c=<Name>&theme=light|dark&fest=diwali|normal` (one), shown in `/design-system.html`. The app renders the same list in its dev gallery (`mobile/app/dev/gallery.tsx`, dev builds only).

**How it is kept true:** `scripts/design-system/registry.mjs` lists the components; `harvest.cjs` copies each one's markup from the live pages (stage) and from the Astro atoms (rendered by a temporary local page that is never committed); `build.mjs` writes `real.css` from the site's own CSS files, `live.html`, `components.json` and the block below. The website never loads any of these files.

<!-- components:start (generated by scripts/design-system/build.mjs from registry.mjs; edit the registry, not this block) -->
### AppHeader
- **Web:** `src/components/ui/organisms/AppHeader.astro` · **React Native:** `AppHeader` (mobile/src/ui)
- **Anatomy:** Logo (or back button) · location picker (pin, area, chevron, tappable) · theme toggle icon button · account icon button. Diwali: string of lights on top.
- **States:** default (logo + location), page (back + title), preorder (indigo). Diwali: maroon gradient #B3123B→#8B0A2E, 2 px gold rule, gold logo #F5D27A; dark Diwali #8B0A2E→#5A0620.
- **Sizes:** Padding 12/16/8 (16 top in Diwali); icon buttons 40×40 round, 1 px translucent border; logo 19/800 −0.03em.
- **Tokens:** --v2-brand, #fff, festive.css header colours
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** Use on every buyer page; keep the theme + account buttons.
- **Don't:** Don't put the seller name in the header (the hero carries it).

### PageHeader
- **Web:** `src/components/ui/organisms/AppHeader.astro (variant page)` · **React Native:** `AppHeader variant="page"` (mobile/src/ui)
- **Anatomy:** Round back button · title (14/700) · theme toggle · account.
- **States:** festive / plain; seller dashboard is never festive.
- **Sizes:** Same as AppHeader.
- **Tokens:** --v2-brand
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** Inner pages (orders, account, order details, dashboard pages).
- **Don't:** No native stack header in the app; use this.

### DiwaliLights
- **Web:** `src/components/DiwaliDecor.astro (lights) + festive.css` · **React Native:** `DiwaliLights` (mobile/src/ui)
- **Anatomy:** Wire (1 px gold 55%) + 24 bulbs (6×8, three warm colours, glow), twinkling 1.6 s staggered.
- **States:** Diwali only; static under reduced motion.
- **Sizes:** 14 px tall, full width.
- **Tokens:** #FFD86B #FFB347 #FFF1C1, rgba(245,210,122,.55)
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** Header, seller hero and splash only.
- **Don't:** Never on the seller dashboard.

### DiwaliBanner
- **Web:** `src/components/DiwaliDecor.astro (banner)` · **React Native:** `DiwaliBanner` (mobile/src/ui)
- **Anatomy:** Diya · "Happy Diwali 🪔" (15/800) over "Wishing you light, joy and good health" (12/500) · diya.
- **States:** light: cream→gold gradient, maroon text; dark: maroon gradient, cream text.
- **Sizes:** Margin 10/16/0, padding 6/14/8, radius 12, 1 px gold border.
- **Tokens:** #D4A24C #FFF1D0 #FBE3A6 #7A0A26 / #3B0A17 #5A0F24 #FDE7B0
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** Home only, under the header.
- **Don't:** Not outside the festive window.

### BottomNav
- **Web:** `src/components/ui/organisms/BottomNav.astro` · **React Native:** `BottomNav` (mobile/src/ui)
- **Anatomy:** 3 items: icon in a 40×28 pill (brand-l when active) + label 12 px (700 active / 500 idle). Filled icon when active, outline otherwise.
- **States:** buyer: Home / Orders / Account; seller: Orders / Inventory / Profile; optional orders badge.
- **Sizes:** 64 px + safe area, 1 px top border, soft shadow.
- **Tokens:** --v2-bg --v2-border --v2-brand --v2-brand-l --v2-ink-4
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** Show on every main buyer page, seller page included.
- **Don't:** Never icon fonts; use the site's SVGs.

### DashboardHero
- **Web:** `src/pages/dashboard/orders/index.astro` · **React Native:** `DashboardHero` (mobile/src/ui)
- **Anatomy:** Green band: greeting "Good day, {shop}" (12) · "Today's pipeline" (20/800) · Stats ▼ toggle.
- **States:** stats collapsed / open.
- **Sizes:** 73 px band.
- **Tokens:** --v2-green, #fff
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** Seller orders page top.
- **Don't:** No Diwali here.

### DashboardTabs
- **Web:** `src/pages/dashboard/orders/index.astro` · **React Native:** `DashboardTabs` (mobile/src/ui)
- **Anatomy:** Tabs New / In Progress / History with red count pills · search input · Range + Type selects · CSV link · "N pending".
- **States:** active tab underline brand.
- **Sizes:** Tabs 40 px; search 34 px; selects 30 px.
- **Tokens:** --v2-brand --v2-red --v2-border
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** Keep search and filters on phones too.
- **Don't:** Don't drop the CSV link in the app.

### PreorderBanner
- **Web:** `src/components/ui/molecules/PreorderBanner.astro (+ notify/blocked states in shop.astro)` · **React Native:** `PreorderBanner` (mobile/src/ui)
- **Anatomy:** Icon tile · title (h4) + line (p) · pill button.
- **States:** pre-order (🌙 Browse), notify (🔔 Allow), blocked (🔕 How).
- **Sizes:** Margin 0 16, radius 12, indigo-l background.
- **Tokens:** --v2-indigo --v2-indigo-l --v2-indigo-d
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** One banner at a time.
- **Don't:** Don't stack it with another promo.

### CategoryStrip
- **Web:** `src/components/ui/molecules/CategoryStrip.astro (+ buildCategoryStrip in shop.astro)` · **React Native:** `CategoryStrip` (mobile/src/ui)
- **Anatomy:** Horizontal rail of round photo tiles (plate photos) with labels; "All Fish" first.
- **States:** active: 3 px brand ring + brand label 700; idle: border ring, ink-3 label.
- **Sizes:** Tiles 64 px, gap ~16, labels 12 px.
- **Tokens:** --v2-brand --v2-border --v2-ink-3
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** Use /fish/*.jpg plate photos; species with listings only.
- **Don't:** No emoji tiles when a photo exists.

### FilterChips
- **Web:** `src/pages/shop.astro (.v2-fchip)` · **React Native:** `FilterChips` (mobile/src/ui)
- **Anatomy:** All · Open now · Pre-order | Pickup · Delivery | Top rated ★, separators 1×20.
- **States:** active: brand fill, white text; idle: bg + 1.5 px border, ink-2.
- **Sizes:** Padding 7/14, 600 12 px, pill.
- **Tokens:** --v2-brand --v2-bg --v2-border --v2-ink-2
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** Toggle groups exactly like the web.
- **Don't:** Don't wrap; it scrolls sideways.

### SectionHead
- **Web:** `src/pages/shop.astro (.v2-section-head)` · **React Native:** `SectionHead` (mobile/src/ui)
- **Anatomy:** Title 18/800 · count badge (brand pill, 12/700 white).
- **States:** count "…" while loading.
- **Sizes:** Padding 20/16/10.
- **Tokens:** --v2-ink --v2-brand
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** Above any list with a count.

### SellerCard
- **Web:** `src/pages/shop.astro (renderFiltered) / molecules/SellerCard.astro` · **React Native:** `SellerCard` (mobile/src/ui)
- **Anatomy:** Cover (store photo + overlay, or hue gradient + Relifish logo) with rating badge · name + ONE status badge · area · km · menu chips (photo, name, ₹/pack, "+N more") · delivery strip (🚲 min/free delivery).
- **States:** open (green), pre-order (indigo), closed (green label "Opens …"); pickup-only tag; Diwali: 1.5 px gold border + gold glow.
- **Sizes:** Radius 16, cover ~160 px, padding 14.
- **Tokens:** --v2-bg --v2-border --v2-green --v2-indigo, festive gold #D4A24C
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** Same order rules as the web (Fishtokri 2nd, radius cap).
- **Don't:** Don't grey out closed sellers.

### SellerCardNoPhoto
- **Web:** `src/pages/shop.astro` · **React Native:** `SellerCard (no store photo)` (mobile/src/ui)
- **Anatomy:** As SellerCard; cover is the seller's hue gradient with the Relifish logo bottom-right.
- **States:** hue: sky / green / orange / indigo from the seller id.
- **Sizes:** —
- **Tokens:** gradients #E0F2FE→#BAE6FD etc.
- **Modes:** light / dark × Diwali / normal (see live.html)

### HomeCartPill
- **Web:** `src/pages/shop.astro (.hc-pill)` · **React Native:** `CartBubble variant="home"` (mobile/src/ui)
- **Anatomy:** Brand pill: up to 2 seller thumbnails · "View cart(s)" 16/800 · "n items · ₹ · n shops" · chevron.
- **States:** one shop (goes to checkout) / several (opens list).
- **Sizes:** min 240 wide, 52 high, 12 px above the bottom nav.
- **Tokens:** #0066FF (literal on the site), #fff
- **Modes:** light / dark × Diwali / normal (see live.html)

### SellerHero
- **Web:** `src/components/ui/organisms/SellerHero.astro` · **React Native:** `SellerHero` (mobile/src/ui)
- **Anatomy:** Cover photo · avatar logo · name (h1) + area · rating badge · tag chips · stats box (items | live status) · timing strip.
- **States:** open / pre-order / closed; Diwali lights over the cover.
- **Sizes:** Cover ~270 px; avatar 60.
- **Tokens:** --v2-bg --v2-border --v2-green --v2-indigo
- **Modes:** light / dark × Diwali / normal (see live.html)

### TimingStrip
- **Web:** `src/components/ui/organisms/SellerHero.astro (last badge)` · **React Native:** `TimingStrip` (mobile/src/ui)
- **Anatomy:** Purple pill: "🌙 Pre-order anytime · delivered Sun & Wed · paused …".
- **States:** pre-order / same-day text from the seller's timings.
- **Sizes:** Full width, wraps to 2 lines.
- **Tokens:** --v2-indigo-l --v2-indigo
- **Modes:** light / dark × Diwali / normal (see live.html)

### MenuHeader
- **Web:** `src/pages/seller/[id].astro` · **React Native:** `MenuHeader` (mobile/src/ui)
- **Anatomy:** "Pre-order Menu" / "Today's Menu" / "Menu (Closed)" 17/800 · "n items" 12/600 ink-3.
- **States:** —
- **Sizes:** —
- **Tokens:** --v2-ink --v2-ink-3
- **Modes:** light / dark × Diwali / normal (see live.html)

### ItemCard
- **Web:** `src/pages/seller/[id].astro (.v2-item-card)` · **React Native:** `ItemCard` (mobile/src/ui)
- **Anatomy:** Photo column 120 px (Pre-order tag) · MOST POPULAR · name 13/600 · size line · description 14/700 · limit · tier rows.
- **States:** in cart (brand border on the tier), sold out, paused.
- **Sizes:** Radius 12, gap 12.
- **Tokens:** --v2-bg --v2-border --v2-brand --v2-purple-ish item-cut
- **Modes:** light / dark × Diwali / normal (see live.html)

### ItemCardInCart
- **Web:** `src/pages/seller/[id].astro` · **React Native:** `ItemCard (tier in cart)` (mobile/src/ui)
- **Anatomy:** As ItemCard; the tier in the cart is brand-tinted with a "− 1 pack +" counter.
- **States:** —
- **Sizes:** —
- **Tokens:** --v2-brand-l --v2-brand
- **Modes:** light / dark × Diwali / normal (see live.html)

### CartBubble
- **Web:** `src/pages/seller/[id].astro (renderCartBar)` · **React Native:** `CartBubble` (mobile/src/ui)
- **Anatomy:** Slot chip above (🌙 Next delivery slot … · free delivery) · brand pill: fish thumbnail, "View cart", "n item · ₹", chevron.
- **States:** below minimum (orange "Add ₹x more"), free delivery reached.
- **Sizes:** Pill 250×56.
- **Tokens:** --v2-brand, #7C3AED (pre-order chip), --v2-green
- **Modes:** light / dark × Diwali / normal (see live.html)

### SheetHeader
- **Web:** `src/components/ui/organisms/BottomSheet.astro` · **React Native:** `BottomSheet` (mobile/src/ui)
- **Anatomy:** Handle 36×4 · title 17/800 · close ×.
- **States:** open / elevated (above another sheet).
- **Sizes:** Radius 20 top.
- **Tokens:** --v2-bg --v2-border
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** Checkout, address, slot and login are sheets.

### StepBar
- **Web:** `src/components/ui/organisms/CheckoutSheet.astro (.v2-co-steps)` · **React Native:** `StepBar` (mobile/src/ui)
- **Anatomy:** Two 4 px bars: cart · delivery.
- **States:** active brand / idle border.
- **Sizes:** —
- **Tokens:** --v2-brand --v2-border
- **Modes:** light / dark × Diwali / normal (see live.html)

### CheckoutCart
- **Web:** `src/components/ui/organisms/CheckoutSheet.astro` · **React Native:** `ShipmentCard + CartLine` (mobile/src/ui)
- **Anatomy:** Shipment row (clock, "Pre-order · Sun 15 Nov", "Shipment of n item from …", Pick time) · ITEMS / Clear · lines: photo, name, "1 pack · ½ Kg", stepper, struck MRP + price.
- **States:** —
- **Sizes:** —
- **Tokens:** --v2-bg --v2-border --v2-brand --v2-ink-3
- **Modes:** light / dark × Diwali / normal (see live.html)

### DiwaliGiftCard
- **Web:** `src/components/ui/organisms/CheckoutSheet.astro (.v2-co-gift)` · **React Native:** `DiwaliGiftCard` (mobile/src/ui)
- **Anatomy:** 🪔 · "Happy Diwali!" + line · Open button.
- **States:** Diwali only.
- **Sizes:** —
- **Tokens:** orange/cream
- **Modes:** light / dark × Diwali / normal (see live.html)

### SuggestRail
- **Web:** `src/components/ui/organisms/CheckoutSheet.astro (yml)` · **React Native:** `SuggestRail` (mobile/src/ui)
- **Anatomy:** "You might also like" · horizontal photo cards with ADD and price.
- **States:** —
- **Sizes:** —
- **Tokens:** --v2-brand
- **Modes:** light / dark × Diwali / normal (see live.html)

### PrepPrefs
- **Web:** `src/components/ui/organisms/CheckoutSheet.astro (.v2-co-prefs)` · **React Native:** `PrepPrefs` (mobile/src/ui)
- **Anatomy:** "How should it be prepared? (optional)" · option chips.
- **States:** —
- **Sizes:** —
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### BillDetails
- **Web:** `src/components/ui/organisms/CheckoutSheet.astro (.v2-co-bill)` · **React Native:** `BillDetails` (mobile/src/ui)
- **Anatomy:** Bill details · free-delivery banner · rows · total · savings bar.
- **States:** —
- **Sizes:** —
- **Tokens:** --v2-green-l --v2-green
- **Modes:** light / dark × Diwali / normal (see live.html)

### CheckoutFoot
- **Web:** `src/components/ui/organisms/CheckoutSheet.astro (.v2-co-foot)` · **React Native:** `CheckoutFoot` (mobile/src/ui)
- **Anatomy:** Delivering-to row (icon, address, Change) · CTA bar "₹649 TOTAL · Next: Delivery ›".
- **States:** step 1 / step 2 (Place order / Pay).
- **Sizes:** —
- **Tokens:** --v2-brand
- **Modes:** light / dark × Diwali / normal (see live.html)

### BuyerOrderCard
- **Web:** `src/pages/track.astro` · **React Native:** `BuyerOrderCard` (mobile/src/ui)
- **Anatomy:** Caps status label · outlined status badge · seller name · "Order #ID · qty · Today" · stepper line with dots and labels.
- **States:** per status colour (green / amber / red / indigo); cancelled = red border tint.
- **Sizes:** Radius 12, padding 16.
- **Tokens:** --v2-red --v2-green --v2-border
- **Modes:** light / dark × Diwali / normal (see live.html)

### StatusHero
- **Web:** `src/pages/track/[id].astro (.v2-od-hero)` · **React Native:** `StatusHero` (mobile/src/ui)
- **Anatomy:** Status (20/800) · order id · time.
- **States:** colour by status.
- **Sizes:** Radius 16.
- **Tokens:** --v2-red --v2-green --v2-brand
- **Modes:** light / dark × Diwali / normal (see live.html)

### OrderStepper
- **Web:** `src/pages/track/[id].astro (.v2-od-stepper) · lib/buyer-order-stepper.ts` · **React Native:** `OrderStepper` (mobile/src/ui)
- **Anatomy:** Dots (done ✓ green, failed ✕ red) joined by lines · labels under.
- **States:** simple 4 / payment 5 / preorder 5 (resolveBuyerStepper).
- **Sizes:** Dots 26.
- **Tokens:** --v2-green --v2-red --v2-border
- **Modes:** light / dark × Diwali / normal (see live.html)

### InfoSection
- **Web:** `src/pages/track/[id].astro (.v2-od-section)` · **React Native:** `InfoSection` (mobile/src/ui)
- **Anatomy:** Caps heading (FROM / ITEMS / DELIVER TO) · content rows.
- **States:** —
- **Sizes:** Radius 12, padding 16.
- **Tokens:** --v2-bg --v2-border --v2-ink-3
- **Modes:** light / dark × Diwali / normal (see live.html)

### BillSummary
- **Web:** `src/pages/track/[id].astro (.v2-od-bill)` · **React Native:** `BillSummary` (mobile/src/ui)
- **Anatomy:** Subtotal · Delivery · Total (bold, rule above) · Final price · payment note.
- **States:** —
- **Sizes:** —
- **Tokens:** --v2-ink --v2-ink-3
- **Modes:** light / dark × Diwali / normal (see live.html)

### ProfileHero
- **Web:** `src/pages/me.astro (.v2-me-hero)` · **React Native:** `ProfileHero` (mobile/src/ui)
- **Anatomy:** Blue gradient with 3 rings · 80 px avatar · name/Welcome · phone · Edit profile.
- **States:** —
- **Sizes:** —
- **Tokens:** --v2-brand
- **Modes:** light / dark × Diwali / normal (see live.html)

### QuickTiles
- **Web:** `src/pages/me.astro (.v2-me-quick)` · **React Native:** `QuickTiles` (mobile/src/ui)
- **Anatomy:** 4 tiles: icon tile + label (Addresses, Orders, Alerts, Call us).
- **States:** —
- **Sizes:** —
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### EmailPrompt
- **Web:** `src/pages/me.astro (#v2-me-email-banner)` · **React Native:** `EmailPrompt` (mobile/src/ui)
- **Anatomy:** Mail icon · "Add email for order updates" · Add → button.
- **States:** hidden once an email is verified.
- **Sizes:** —
- **Tokens:** --v2-brand-l --v2-brand
- **Modes:** light / dark × Diwali / normal (see live.html)

### MeSectionHead
- **Web:** `src/pages/me.astro (.v2-me-section-head)` · **React Native:** `SectionHead variant="rule"` (mobile/src/ui)
- **Anatomy:** Title 14/700 with a hairline to the right.
- **States:** —
- **Sizes:** —
- **Tokens:** --v2-border
- **Modes:** light / dark × Diwali / normal (see live.html)

### SavedAddress
- **Web:** `src/pages/me.astro (.v2-me-addr-card)` · **React Native:** `SavedAddress` (mobile/src/ui)
- **Anatomy:** Label + DEFAULT tag · address text · delete icon.
- **States:** default / other.
- **Sizes:** —
- **Tokens:** --v2-green --v2-red
- **Modes:** light / dark × Diwali / normal (see live.html)

### OrderHistoryRow
- **Web:** `src/pages/me.astro (#v2-me-orders)` · **React Native:** `OrderHistoryRow` (mobile/src/ui)
- **Anatomy:** Seller · status pill · date · qty species · total · View →.
- **States:** —
- **Sizes:** —
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### SellerOrderCard
- **Web:** `src/pages/dashboard/orders/index.astro (.v2-seller-order)` · **React Native:** `SellerOrderCard` (mobile/src/ui)
- **Anatomy:** #ID · last 4 · time · PAID + status badges · "n items" · lines (option/cut, per-line badge, price) · refund box · SAME DAY / DELIVERY tags · area + km · total · payment + ref · Next note · green paid line · actions.
- **States:** New / In progress / History; every action (accept, decline, seller_cancel, item_cancel, ready, out_for_delivery, delivered, pod lock, pod_refused, set_final_price, retry_refund, check payment).
- **Sizes:** Radius 12, padding 16.
- **Tokens:** --v2-green --v2-orange --v2-red --v2-brand
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** Show everything the web shows.
- **Don't:** Don't summarise lines away.

### ListingCard
- **Web:** `src/pages/dashboard/listings/index.astro (.v2-listing-card)` · **React Native:** `ListingCard` (mobile/src/ui)
- **Anatomy:** Up/down arrows · photo · name · size · ₹/unit · Live / Pre-order / stock / packs chips · Edit / Pause / Delete.
- **States:** live / paused / sold out.
- **Sizes:** —
- **Tokens:** --v2-green --v2-indigo --v2-red
- **Modes:** light / dark × Diwali / normal (see live.html)

### FormField
- **Web:** `src/components/ui/atoms/Input.astro in pages/dashboard/profile.astro` · **React Native:** `Input (FormField)` (mobile/src/ui)
- **Anatomy:** Label (+ red *) · input 44 px.
- **States:** —
- **Sizes:** —
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### LocationBox
- **Web:** `src/pages/dashboard/profile.astro` · **React Native:** `LocationBox` (mobile/src/ui)
- **Anatomy:** "✅ Location set" · area · coordinates · Use my current location · helper.
- **States:** set / not set.
- **Sizes:** —
- **Tokens:** --v2-green --v2-brand
- **Modes:** light / dark × Diwali / normal (see live.html)

### Button
- **Web:** `src/components/ui/atoms/Button.astro` · **React Native:** `Button` (mobile/src/ui)
- **Anatomy:** v2-btn + variant + size
- **States:** primary / secondary / ghost / danger; disabled (45%), loading (spinner)
- **Sizes:** sm 36 · md 44 (12/24 padding, 14/700) · lg; full width
- **Tokens:** --v2-brand --v2-brand-d --v2-red
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** One primary per view.
- **Don't:** No custom colours.

### Badge
- **Web:** `src/components/ui/atoms/Badge.astro` · **React Native:** `Badge` (mobile/src/ui)
- **Anatomy:** v2-badge + variant (rating/offer/tag/status) + colour + size
- **States:** green, indigo, red, orange, brand, ink
- **Sizes:** sm / md / lg
- **Tokens:** status colours
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Do:** One status badge per card.

### Input
- **Web:** `src/components/ui/atoms/Input.astro` · **React Native:** `Input` (mobile/src/ui)
- **Anatomy:** Label (+*) · input (prefix optional) · helper/error/success line
- **States:** default / focus / error / success / disabled
- **Sizes:** 44 px, radius 8, 1.5 px border
- **Tokens:** --v2-border --v2-brand --v2-red --v2-green
- **Modes:** light / dark × Diwali / normal (see live.html)

### PhoneInput
- **Web:** `src/components/ui/atoms/PhoneInput.astro` · **React Native:** `PhoneInput` (mobile/src/ui)
- **Anatomy:** Label · +91 prefix · 10-digit input
- **States:** —
- **Sizes:** —
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### OTPInput
- **Web:** `src/components/ui/atoms/OTPInput.astro` · **React Native:** `OTPInput` (mobile/src/ui)
- **Anatomy:** 6 cells, auto-advance, paste, auto-submit
- **States:** focus / filled / error
- **Sizes:** cells ~44×52
- **Tokens:** --v2-brand --v2-border
- **Modes:** light / dark × Diwali / normal (see live.html)

### Textarea
- **Web:** `src/components/ui/atoms/Textarea.astro` · **React Native:** `Textarea` (mobile/src/ui)
- **Anatomy:** Label · textarea · helper
- **States:** —
- **Sizes:** —
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### Spinner
- **Web:** `src/components/ui/atoms/Spinner.astro` · **React Native:** `Spinner` (mobile/src/ui)
- **Anatomy:** Ring spinner
- **States:** brand / green
- **Sizes:** sm / md / lg
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### Skeleton
- **Web:** `src/components/ui/atoms/Skeleton.astro` · **React Native:** `Skeleton` (mobile/src/ui)
- **Anatomy:** Shimmer block
- **States:** card / line / circle
- **Sizes:** —
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)
- **Don't:** Not on /shop (the splash covers loading).

### Progress
- **Web:** `src/components/ui/atoms/Progress.astro` · **React Native:** `Progress` (mobile/src/ui)
- **Anatomy:** Bar
- **States:** brand / green / orange / indeterminate
- **Sizes:** 6 px
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### SlotPicker
- **Web:** `src/components/ui/atoms/SlotPicker.astro` · **React Native:** `SlotPicker` (mobile/src/ui)
- **Anatomy:** Group title · slot tiles (time, label, fee)
- **States:** selected / disabled
- **Sizes:** —
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### AddressCard
- **Web:** `src/components/ui/molecules/AddressCard.astro` · **React Native:** `AddressCard` (mobile/src/ui)
- **Anatomy:** Icon · label · Default tag · text · Edit
- **States:** selected / selectable
- **Sizes:** —
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### EmptyState
- **Web:** `src/components/ui/molecules/EmptyState.astro` · **React Native:** `EmptyState` (mobile/src/ui)
- **Anatomy:** Icon · title · description · CTA (+ ghost, call us)
- **States:** no-area, closed, no-results, no-orders, cart-empty, no-internet, server-error
- **Sizes:** —
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### ErrorState
- **Web:** `src/components/ui/molecules/ErrorState.astro` · **React Native:** `ErrorState` (mobile/src/ui)
- **Anatomy:** Icon circle · title · description · actions
- **States:** sold-out, seller-closed, payment-failed, otp-wrong, …
- **Sizes:** —
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### PermissionPrompt
- **Web:** `src/components/ui/molecules/PermissionPrompt.astro` · **React Native:** `PermissionPrompt` (mobile/src/ui)
- **Anatomy:** Icon · title · description · benefits · Allow / Skip
- **States:** location / notifications
- **Sizes:** —
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### CartBar
- **Web:** `src/components/ui/molecules/CartBar.astro` · **React Native:** `CartBar` (mobile/src/ui)
- **Anatomy:** Left line · total · CTA
- **States:** default / warning (below min) / success (free delivery) / preorder
- **Sizes:** —
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### PreorderBannerHero
- **Web:** `src/components/ui/molecules/PreorderBanner.astro` · **React Native:** `PreorderBanner variant="hero"|"empty"` (mobile/src/ui)
- **Anatomy:** Hero and empty variants of PreorderBanner
- **States:** —
- **Sizes:** —
- **Tokens:** —
- **Modes:** light / dark × Diwali / normal (see live.html)

### Toast
- **Web:** `src/components/ui/atoms/Toast.astro (window.v2Toast)` · **React Native:** `Toast` (mobile/src/ui)
- **Anatomy:** Icon · title · description · close.
- **States:** success / error / warning / info; max 1, dedup.
- **Sizes:** —
- **Tokens:** --v2-green --v2-red --v2-orange --v2-brand
- **Modes:** light / dark × Diwali / normal (see live.html)
### LoginPanel (buyer + seller)
- **Web:** `src/components/ui/organisms/LoginSheet.astro` (`.lg-*`) · **React Native:** `app/login.tsx`
- **Anatomy:** Full-screen photo behind (buyer: `login-collage.jpg` fish plates; seller: `seller-login.jpg` dock, dashboard green tint) · white bottom panel (24 radius) · logo badge overlapping the top (brand; Diwali: maroon + gold border + gold logo; seller: green + "PARTNER · FOR SELLERS") · tagline 20/800 · sub 13 · "Log in or sign up" divider · 54 px +91 field · Continue (grey until valid) · WhatsApp opt-in (buyer only) · terms. OTP step: back, "OTP verification", "Sent by SMS to … · Change", "The code is valid for 10 minutes.", six 46×54 boxes, "Reading the code from SMS…" (only while auto-read listens), Verify, "Resend SMS in 0:30", "Need help? Call us".
- **States:** phone / OTP / error / busy; seller adds "New seller or need help? Call us" and the link to the buyer side.
- **Auto-read:** Android SMS User Consent (`mobile/modules/sms-consent`), iOS oneTimeCode, web WebOTP (`OTPInput.astro`, needs the SMS last line `@www.relifish.com #code`).
- **Modes:** light / dark × Diwali / normal. The panel rises with the keyboard (Android edge-to-edge).

### Splash
- **Web:** `#rf-splash` in `AppShell.astro` · **React Native:** native (`expo-splash-screen`, square `splash-gold|white.png`, wordmark in the middle 60 % because Android 12 masks to a circle) + `src/Splash.tsx` (2 s, fade 350 ms)
- **Anatomy:** Diwali: maroon radial, lights, gold logo, "Wishing you light, joy and good health", HAPPY DIWALI, diya. Normal: brand gradient, white logo, "Fresh fish. Cleaned. Cut. At your door.", sellers line, fish.

### PushPrePrompt
- **React Native:** `src/PushPrePrompt.tsx` (once, on the order page, while notifications are undecided)
- **Anatomy:** bell circle · "Know the moment your fish is on its way" · only the pushes we send (confirmed with slot, out for delivery, refunds) · Turn on updates · Not now.

### RichNotification (Android)
- **Server:** `src/lib/server/fcm.ts` (data-only for Android, APNs alert with image for iOS) · **App:** `showRich` in `mobile/src/ring.ts`
- **Anatomy:** title · body · fish photo as big picture (400 px copy; Android's limit is 1 MB) · Track order · Call us. Tap opens the order.

### NewOrderRing (Partner)
- **React Native:** `src/NewOrderAlarm.tsx` (in app) + `showRing` in `src/ring.ts` (lock screen, full-screen intent, loops 60 s)
- **Anatomy:** green full screen · NEW ORDER · amount 48/900 · paid / pay on delivery · items card (cancelled lines struck) · area + km, same day / pre-order + slot, buyer last 4 · Slide to confirm · View order / Can't fulfil. No timers (there is no confirm deadline).

### Timeline (tracking)
- **Web:** `.v2-tl` in `pages/track/[id].astro` · **React Native:** `Timeline` + `TrackHero` (mobile/src/ui/orders.tsx)
- **Anatomy:** one row per real stepper label (`lib/buyer-order-stepper.ts`): done (green tick), now (blue ring + number), next (grey), failed (red). Times only from real timestamps (created_at, payment_verified_at).

### KpiStrip / PrepList (Partner dashboard)
- **React Native:** `KpiStrip`, `PrepList` (mobile/src/ui/dashboard.tsx)
- **Anatomy:** three translucent tiles on the green hero (to confirm, in progress, next slot); prep list = packs per fish for the next delivery slot.
<!-- components:end -->
