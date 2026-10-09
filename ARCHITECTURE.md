# Relifish — Architecture

> Before writing any code, read the relevant section here.
> Before creating a new lib file, check if one already exists.
> If a pattern isn't documented here, add it before merging.

---

## System Overview

```
Browser
  ├── Buyer flows    → /shop, /s/[slug], /s/[slug]/[species], /track, /me, /search, /preorder
  └── Seller flows   → /dashboard/**

Astro SSR (Vercel)
  ├── Pages          → src/pages/**
  ├── API routes     → src/pages/api/**
  ├── Lib (shared)   → src/lib/**
  └── Components     → src/components/**

Supabase
  ├── DB (Postgres)  → sellers, fish_listings, orders, buyers, addresses
  ├── Auth           → phone OTP
  └── Storage        → fish-photos (public), order-payments (private)
```

---

## Domain Architecture Map

### Timing & Seller Status

```
src/lib/order-timing.ts          ← SINGLE SOURCE OF TRUTH
  │
  ├── isSellerEffectivelyOpen()  → "is seller open for same-day orders RIGHT NOW?"
  ├── isPreorderShoppingWindow() → "is seller accepting pre-orders RIGHT NOW?"
  ├── classifyPlacementAtOrderTime() → "same_day" | "preorder" | "closed"
  ├── todayDayName()             → IST-aware day string (sun/mon/...)
  ├── minutesNowIST()            → minutes since midnight in IST
  └── closedSellerMessage()      → human-readable closed reason
  │
  ├── Consumers (server):
  │     src/pages/api/orders/create.ts
  │     src/lib/server/resolve-listing-order-line.ts
  │     src/pages/api/sellers/nearby.ts
  │     src/pages/dashboard/listings/index.astro
  │
  └── Consumers (client — must inline IST helpers, cannot import):
        src/pages/shop.astro     → minutesNowIST(), todayDayNameIST(), isPastCutoff()
        src/pages/seller/[id].astro → own inline IST block (server-side Astro frontmatter)
```

**Rule:** Never add a 4th timing implementation. Import `order-timing.ts` on server. Mirror the exact same IST pattern on client if import is not possible.

---

### Cart

```
src/lib/cart.ts                  ← SINGLE SOURCE OF TRUTH
  │
  ├── CartItem type              → what lives in localStorage per listing
  ├── CartMap type               → Record<listing_id, CartItem>
  ├── SellerGroup type           → grouped items per seller with subtotal
  ├── getCart()                  → read from localStorage
  ├── groupBySeller()            → group CartMap into SellerGroup[]
  ├── addItem() / removeItem()   → mutate + sync to server
  └── syncFromServer()           → server cart wins on conflict
  │
  ├── Storage key: "v2_cart_global" (never access directly outside cart.ts)
  │
  └── Consumers:
        src/pages/shop.astro     → window.RelifishCart (bundled client script)
        src/pages/seller/[id].astro
        src/components/ui/organisms/CartStackSheet.astro
        src/components/ui/organisms/CartBar.astro
```

**Rule:** `seller_image_url` in cart items may be stale (set at add-to-cart time). Always fall back to `window.__sellerPageData.imageUrl` or `window.__v2allGroups` for display. Never trust the cached URL as the source of truth for images.

---

### Orders

```
Order lifecycle:
  pending_payment → confirmed → paid → ready_for_pickup → picked_up/completed
                              ↘ payment_required (preorder price delta)
                 → declined / cancelled / refunded

placement_kind (set at create, never changes):
  same_day   → seller was open at order time
  preorder   → seller was in preorder window at order time

Source of truth for placement: orders.placement_kind (DB column)
Source of truth for timing: src/lib/order-timing.ts (at placement time)
```

```
API routes:
  POST /api/orders/create              → validates timing, creates order
  POST /api/orders/create-seller-cart  → pre-order cart variant
  GET  /api/orders/detail              → single order
  POST /api/orders/cancel              → buyer cancel
  POST /api/orders/upload-payment      → UPI screenshot
  POST /api/orders/feedback            → post-delivery rating

Server validation chain:
  create.ts → resolve-listing-order-line.ts → classifyPlacementAtOrderTime()
```

---

### Seller Routes — URL Architecture

```
Canonical host: https://www.relifish.store
  SITE_URL + canonicalFor(path) in src/lib/brand.ts   → www, no query, no trailing slash
  siteOriginFromEnv() in src/lib/server/site-origin.ts → www in production
  vercel.json: apex relifish.store → 308 → www (except /api/* and /sw.js)

Public (indexed by Google):
  /s/[slug]              → canonical seller URL (SEO)
    └── Astro.rewrite → /seller/[id] (server-side, browser URL stays /s/slug)
    └── no seller → inline 404 page (noindex); DB error → 503 + Retry-After: 120
        (no 302 to /shop: Google treats that as a soft 404)
  /s/[slug]/[species]    → one fish from one seller: price + availability,
                           schema.org Product JSON-LD (src/lib/product-offer.ts).
                           Same 404/503 contract. Ordering stays on /s/[slug].
  /shop                  → SSR crawlable seller list (src/lib/crawl-sellers.ts)
                           above the JS-filled grid; s-maxage=300, no-store on DB error

Fallback:
  /seller/[id]           → used as the canonical only when the seller name has no
                           latin characters (empty slug). sellerHref() decides.
                           404 / 503 on missing seller or outage.

robots.txt:
  Sitemaps: /sitemap-index.xml (static pages) + /sitemap.xml (sellers, fish pages, areas)
  sitemap.xml lists /s/[slug] and /s/[slug]/[species] (only species with a price)
```

**Rule:** Build seller links with `sellerHref(name, id)` from `src/lib/seller-display.ts`. It returns `/s/[slug]`, or `/seller/[id]` when the slug would be empty. Never hand-roll the slug regex.

**Slug generation:** `sellerNameToSlug(seller.name)` — derived from name at runtime. **Known risk:** if seller renames, slug changes and old URLs 404. Fix: add `sellers.slug` DB column (P0 backlog).

---

### Analytics

```
src/components/ui/AppShell.astro   ← ALL analytics scripts live here
  (legacy src/components/AppShell.astro: gtag G-7MXZDZ1S4N, FB Pixel, Vercel Analytics)

Always on (not gated by PUBLIC_ENABLE_TRACKING):
  UtmCapture.astro                 → URL utm_* → localStorage "rf_utm"
                                     {source, medium, campaign, content, at}
                                     last-touch; utm_source=blog never overwrites

Scripts loaded when PUBLIC_ENABLE_TRACKING=true (in order):
  1. GTM (GTM-JG2ZTX3F)           → Google Tag Manager container
  2. gtag: G-DGS7557PZ6 + G-7MXZDZ1S4N (GA4 property 539604989 web stream)
     + utm_landing event when utm_source is in the URL
  3. Microsoft Clarity             → session recording + heatmaps
  4. Facebook Pixel (1197248829088195) → PageView on every page
  5. Vercel Analytics (@vercel/analytics/astro) → separate from GA4
  (Firebase SDK removed: G-7MXZDZ1S4N now reports through plain gtag)

Order attribution:
  seller/[id] checkout sends rf_utm → POST /api/orders/create-seller-cart
  → pickUtm() (src/lib/utm.ts: strings only, 100 chars, 30-day window)
  → orders.utm_source / utm_medium / utm_campaign / utm_content (migration 075)
  Best effort: a failed UTM write never fails the order.

GA4 events:
  utm_landing    → UTM params present in URL (utm_source, utm_medium, utm_campaign)
  order_placed   → checkout created the order(s) (seller/[id].astro)
  purchase       → Razorpay payment verified (track/[id].astro), plus FB Purchase
  sign_up        → first OTP login as a new buyer (LoginSheet, is_new from verify-otp)
  seller_signup  → first OTP login as a new seller
```

**Rule:** Never add analytics scripts outside AppShell. Never hardcode measurement IDs in page files. Pages fire events through `gtag`/`track` guarded by `typeof gtag === "function"`.

---

### Supabase Client

```
src/lib/supabase.ts    ← ONE client instance

export const supabase = createClient(url, anonKey);
```

**Rule:** Never call `createClient()` anywhere else. Never import supabase-js directly in a page.

**Bucket access:**
- `fish-photos` → public bucket (listing photos, store images, seller banners)
- `order-payments` → private bucket (UPI screenshots) — always use signed URLs, never expose public URLs

---

### Authentication

```
Buyer auth:
  localStorage: rlf_buyer_id, rlf_phone
  OTP flow: POST /api/auth/send-otp → POST /api/auth/verify-otp
  Check: getBuyerId() from src/lib/cart.ts or localStorage direct

Seller auth:
  localStorage: rlf_seller_id, rlf_seller_phone
  OTP flow: same endpoints, different table lookup
  Check: src/lib/seller-auth.ts → getAuthenticatedSeller()
  Dashboard redirect: /dashboard/login if not authenticated
```

**Rule:** `buyer_id` and `seller_id` used for data access must come from a session/cookie or server-verified token, NOT from the request body. Body values are used for display only.

---

### Push Notifications

```
Buyer push:  src/lib/server/buyer-push.ts
Seller push: src/lib/seller-push.ts
VAPID keys:  src/lib/server/vapid-env.ts
Loading:     src/lib/server/load-web-push.ts

Service worker: /sw.js (public/)

Events that trigger push:
  order created     → seller gets push + email
  payment uploaded  → seller gets push + email
  status changed    → buyer gets push
  cancel            → both get push
```

---

### Email

```
src/lib/email-templates.ts   ← ALL email HTML here

Functions:
  shell()              → wraps any email in brand shell
  transactionIntro()   → order header block
  formatOrderQuantityEmailRows() → line items table

Transactional emails sent from:
  src/pages/api/orders/create.ts
  src/pages/api/orders/update-notes.ts (status change)
  src/pages/api/auth/verify-email.ts
```

---

### Component Hierarchy

```
AppShell.astro          ← root layout, all <head> scripts, analytics
  ├── AppHeader.astro   ← top navigation, location prompt trigger
  ├── BottomNav.astro   ← buyer bottom tab bar
  └── [page content]
        ├── BottomSheet.astro    ← modal shell (reused for all sheets)
        │     ├── LoginSheet.astro
        │     ├── CheckoutSheet.astro
        │     ├── CartStackSheet.astro   ← "Your Carts" multi-seller view
        │     └── AddressPickerSheet.astro
        ├── CartBar.astro        ← sticky bottom bar showing cart total
        └── Toast.astro          ← top notification toasts
```

---

### Data Flow — Seller Page

```
Request: GET /s/bombay-fish-market

1. s/[slug].astro:
   - getSellerBySlug(slug.toLowerCase()) → seller row
   - found → Astro.rewrite("/seller/{seller.id}")
   - not found → 404 inline; DB error → 503 (Astro.rewrite("/404") throws here:
     404.astro is prerendered)

2. seller/[id].astro (server frontmatter):
   - getSellerById(id) + getSellerListings(id)
     (lookup error → sellerLookupOutcome(): PGRST116/22P02 = 404, else 503)
   - Compute isEffectivelyOpen, isPreorderMode, isClosed (IST)
   - Filter listings by mode
   - Build JSON-LD schema with canonical sellerHref() URL; MenuItems link to
     /s/[slug]/[species]
   - Render page with correct canonical + "Fish from <seller>" links

3. Client-side script:
   - window.__sellerPageData = { id, imageUrl } ← for CartStackSheet fallback
   - RelifishCart initialises, syncs from server
   - Add-to-cart captures seller_image_url at add time
```

---

### Data Flow — Shop Page

```
Request: GET /shop (or app.relifish.store → rewrite)

1. Server: renders shell + crawlable seller list (buildCrawlSellers, 1.5s DB timeout;
   on error the list is empty and the response is Cache-Control: no-store)

2. Client: loadSellers() fetch
   - GET /api/sellers + GET fish_listings join
   - For each seller: isOpen() + isPastCutoff() + isTodayOrderDay() (IST inline)
   - Classify: open | preorder | closed
   - Badge: "Open now" | "Pre-orders open" | "Closed" | "Pre-order only"
     ↑ "Pre-orders open" uses g.preorderMode (cutoff-aware), not preorderAvailableToday

3. window.__v2allGroups = groups  ← CartStackSheet fallback for seller images
```

---

## Decision Log

| Decision | Reason | Date |
|----------|--------|------|
| Timing source of truth = `order-timing.ts` | Prevent drift across 5+ files. Any timezone bug fixed once. | 2026-04 |
| `/seller/[id]` returns 404 on direct access | SEO dedup — `/s/[slug]` is canonical | 2026-05 |
| Cart in localStorage with server sync | Offline-first UX. Server cart is source of truth on conflict. | 2026-04 |
| UTM in sessionStorage not URL params (superseded 2026-10, see below) | URL params lost on SPA navigation. sessionStorage persists for session. | 2026-05 |
| Astro over Next.js | SSR without JS overhead on static content. Vercel native. | 2026-01 |
| Supabase anon key in client | Row-level security enforced in Postgres. Anon key is safe to expose. | 2026-01 |
| Canonical host is www; apex 308s to it | One indexed URL per page; GSC property is the www URL prefix. | 2026-10 |
| Missing seller = 404/503, not 302 to /shop | Google reads redirect-to-listing as a soft 404; 503 makes it retry during outages. | 2026-10 |
| UTM in localStorage `rf_utm`, last touch, 30 days, stored on orders | A campaign gets credit for orders up to 30 days after landing; the attribution lives on the order row, not only in GA. | 2026-10 |

---

## Known Technical Debt (prioritised)

| Priority | Issue | Impact | Fix |
|----------|-------|--------|-----|
| P0 | `sellers.slug` derived from name — renames break URLs | SEO destroyed if seller renames | Add `slug` DB column, set at creation |
| P1 | Cart `seller_image_url` may be stale in localStorage | Fish icon bug (partially fixed with `__sellerPageData`) | Server-side cart as primary |
| P2 | `SELECT *` on sellers + listings — no pagination | Breaks at 200+ sellers | `limit`/`offset` + infinite scroll |
| P3 | Seller status computed client-side in shop.astro | Main thread blocks at scale | Pre-classify in server API |
| P4 | GA measurement ID hardcoded in AppShell | Dev + prod share same GA4 property | Environment variable |
