# Changelog

All notable changes to Relifish are documented here.

## [0.2.2.0] - 2026-05-20

### Added
- `/for-sellers` seller marketing landing page — OS pipeline diagram, timeline milestones (Day 1 / Week 1 / Week 2 / Month 1+), brutal outcome content, "Bring your customers. Gain new ones." growth section, deep Revenue and Compounds steps with before/after comparisons, 10-question FAQ, and structured JSON-LD (WebPage, Service, Organization, HowTo, FAQPage)
- Preorder revenue model explainer — cold storage cost elimination, calculated logistics, predictable stock-fill comparison (before vs. with Relifish)
- Two-engine customer growth section — Engine 1 (existing customers, Week 1 with Day 1/Day 2-3/Week 1 milestones) and Engine 2 (new customers, Week 2-3 with discovery → engagement momentum)

### Changed
- "Inventory" replaces "Listings" across all seller-facing UI labels (dashboard nav, page titles, empty states) — URLs unchanged
- Favicon updated to local `/favicon.png` + `/favicon.svg` (was Supabase CDN URL, which could fail offline)
- Seller UUID pages (`/seller/[id]`) now carry `noindex` — canonical URL is `/s/[slug]`
- for-sellers SEO: title "Sell Fish Online Mumbai — Free Store, Zero Commission | Relifish", expanded meta description, JSON-LD schema corrected (HowTo separated from FAQPage into proper @graph nodes)
- Payments copy updated to UPI · COD — Razorpay removed from all marketing copy (payment processing code untouched)
- Testimonials heading changed to "Real problems solving"
- Hero updated: "Start accepting orders in your serviceable area"
- Full-width layout restored — `.v2-main` max-width constraint removed
- OS pipeline diagram with timeline markers and stage tooltips

### Fixed
- Phone mockup width increased to 270px
- CTA note top margin corrected (20px)

## [0.2.1.0] - 2026-05-20

### Fixed
- Seller pages (`/s/seller-name`) returning 404 — `Astro.locals` is not preserved across `Astro.rewrite()`, so the guard was blocking all visits. Removed guard; SEO dedup handled by canonical tag + `Disallow: /seller/` in robots.txt
- Buyer "Account" tab in bottom nav now correctly links sellers to `/dashboard/profile` instead of the buyer profile page
- Shop page "Pre-orders open" badge now checks cutoff time — was showing pre-orders open even after cutoff had passed (the Fishthokri bug)
- `order-timing.ts` `todayDayName()` was using UTC server time (`d.getDay()`). Between 18:30–23:59 UTC (midnight–5:30 IST), the wrong day was returned, causing orders to be misclassified
- Shop page timing now uses IST instead of browser local time
- `sellers/nearby` API rewired to use `isSellerEffectivelyOpen` from `order-timing.ts`
- "Browse other sellers" CTA on closed seller page now links to `/shop`
- Cart bottom sheet now shows seller store photo instead of fish icon when localStorage has a stale null image
- Buyer profile page orders no longer instantiate Supabase directly in the browser — now uses `/api/buyer/orders` server-side endpoint
- Landing page carousel bottom buttons now clear the phone mockup border radius (padding-bottom was 10–12px, now 20px)
- UTM params from flyer QR codes now tracked via `utm_landing` GA4 event and sessionStorage

### Added
- `/api/buyer/orders` — paginated past order history endpoint with UUID validation, phone normalisation, and RLS-safe anon key
- `STANDARDS.md`, `ARCHITECTURE.md`, `SECURITY.md` — enterprise reference docs for coding standards, domain architecture, and security rules
- Regression tests for `todayDayName()` IST midnight boundary (4 test cases covering the UTC/IST crossover window)

## [0.2.0.1] - 2026-05-19

### Changed
- Landing page fish grid now uses real food photography (Pomfret, Surmai, Prawns, Bangda, Rawas, Crab) from hosted URLs; Halwa and Bombay Duck hidden pending photos
- Fish card image height increased to 220px; text area padding tightened for better image-to-text ratio
- Fish grid columns widened (minmax 280px) for a cleaner 2-column layout on mobile
- "Mud Crab" renamed to "Crab" across landing page and flyer
- Surmai image URL corrected (fr4-z prefix)
- Flyer fish card images enlarged (52px → 96px) with tighter text padding
- Seller dashboard login hero constrained to AppShell max-width (800px) with border-radius; removed full-bleed breakout
- Sticky "Sign in with phone" footer now respects 800px max-width, matching the hero card width
- All demo carousel CTAs (d1 location, d4 cart, s1 seller location) now `position:absolute;bottom:0` matching the d5 reference design

## [0.2.0.0] - 2026-05-18

### Added
- **Razorpay payment integration** — buyers can pay for orders via Razorpay checkout (toggle with `PUBLIC_ENABLE_RAZORPAY=true`); old UPI screenshot flow remains the default when flag is off
- **Razorpay security hardening** — payment verification cross-checks `razorpay_order_id` against DB to prevent replay attacks; race condition guard checks update row count before firing notifications
- **Payment confirmation emails** — buyer receives a styled receipt email after Razorpay payment; seller receives a new-order notification
- **Relifish brand logos** — replaced all fish emoji brand marks across the app with the official `logo_horizontal.png` wordmark; favicon updated to `favicon.png` (R icon mark) via direct PNG link
- **Flyer redesign** — A5 print flyer with psychology-optimised layout: anchoring, loss aversion, and social proof; live prices from DB; front + back pages
- **Seller map** — interactive map showing seller locations with real coordinates from DB
- **Facebook Pixel** — event tracking integrated on landing and order flows
- **Google Analytics, Clarity, and Google Tag Manager** — analytics stack wired up across all pages
- **Checkout session grouping** — migrations 054/055 add `checkout_session` table for atomic multi-item cart checkout

### Changed
- **Component directory rename** — `src/components/v2/` → `src/components/ui/` for cleaner imports; all page references updated
- **Email templates overhauled** — full Relifish branding, dark header with white logo, itemised order summary, refund and receipt templates added
- **manifest.json** — icons updated to `favicon.png` replacing old SVG icon-192/icon-512 references
- **buyer-banner.html / seller-banner.html** — Relifish logo header strip added to top of each page

### Fixed
- **Flyer live prices** — corrected `deleted_at` filter so only active listings appear in price grid
- **Logo rendering on dark backgrounds** — `filter:brightness(0) invert(1)` applied wherever logo appears on dark/coloured backgrounds; `object-fit:cover` used to eliminate letterbox padding from landscape canvas

## [0.1.3.0] - 2026-05-11

### Added
- **8 new fish species** in the species catalogue: Halwa (Black Pomfret), Katla, Salmon, Bhetki, Ghol, Basa, Shark (Mushi), Boi (Mullet) — all available in the listing form dropdown
- **Jumbo size grade** — `fish_size` now supports `jumbo` in addition to small/medium/large (migration 053); Jumbo option added to listing form size dropdown
- **Bombay Sea Food listings** — 21 clean fish listings seeded for seller `f3339b19` with images uploaded to `fish-photos` bucket and correct species IDs linked

### Fixed
- **Duplicate pre-order section** — listing form showed two identical "Pre-order settings" panels; removed the extra one
- **Seller hero banner fade** — store banner image now fades smoothly into page content via gradient overlay; removed hardcoded blue background gradient

### Changed
- **robots.txt** — removed AI crawler (GPTBot, Bytespider) blocks to allow AI search indexing and citations

## [0.1.2.0] - 2026-05-11

### Added
- **Hero phone mockup** is taller and wider (270×500px, up from 240×360px) — fills the full-screen hero section better on all screens
- **AI chat widget** (ready to enable): floating assistant powered by Claude Haiku via Vercel AI SDK, grounded in Relifish product knowledge — uncomment in `index.astro` and set `ANTHROPIC_API_KEY` to activate
- **`/api/chat` endpoint**: POST handler accepting conversation history, returning Claude-generated responses about Relifish

### Changed
- Replaced direct `@anthropic-ai/sdk` with `@ai-sdk/anthropic` (Vercel AI SDK) for the chat endpoint — cleaner streaming support when the widget ships

## [0.1.1.0] - 2026-05-05

### Fixed
- **Store open/closed/pre-order state**: stores now follow a clear priority — open hours show the order menu, closed + pre-orders enabled + before cutoff shows only the pre-order menu, otherwise the store is fully locked with an "Opens at X" note
- **Pre-order cutoff time**: pre-orders automatically stop accepting after the seller's cutoff time (in IST); day-of-week check also uses IST, fixing a bug where midnight crossover picked the wrong day
- **Pre-order menu was hidden when store closed**: buyers now correctly see the pre-order menu during the pre-order window instead of the "Closed right now" block
- **"Accept pre-orders" toggle is now a hard off-switch**: turning off pre-orders in the seller profile immediately disables the pre-order menu, even if individual listings still have pre-order enabled
- **Location picker map**: map now loads reliably in the location sheet — was sometimes failing to init because Leaflet hadn't loaded yet
- **Buyer home location gate**: home page now shows a "Set location" prompt before showing seller cards; only sellers within the buyer's area are shown
- **Bundle unit label**: a 3-piece bundle listing now correctly shows `/3pc` instead of `/piece` on seller cards and the home page
- **Seller card chips**: home page seller cards now show a maximum of 2 listing chips, with a `+N` badge for sellers with more listings
- **Closed seller page**: visiting a closed seller's page now shows a locked state with the opening time — no menu, no ordering

## [0.1.0.0] - 2026-04-22

### Added
- **Pre-order form UI**: sellers can enable pre-orders per listing with min/max quantity range; buyers see "Next-day catch" pricing reconciliation info
- **Seller set-final-price flow**: pre-order orders in seller dashboard now show a final price input instead of "Confirm" — seller enters actual price after the morning catch; API calls `reconcile_preorder_price` to auto-refund or request balance
- **Buyer pre-order track page**: purple hero, "🌙 Next-day catch pre-order" info box with refund policy ("if final < paid → refund within 7 days")
- **Cancelled orders with paid_amount > 0**: seller can now upload UPI screenshot and mark refund sent (same as refunded status flow)
- **Payment screenshot visibility**: buyers can view their own uploaded screenshots via `/api/orders/payment-screenshots`; sellers see "View proof" buttons for pending_payment orders
- **IST timezone fix**: `isSellerCurrentlyOpen()` now uses `Date.now() + 5.5h` offset to match India Standard Time on Vercel UTC servers

### Fixed
- `pending_payment` and `payment_required` statuses added to seller dashboard tab routing — orders no longer vanish when buyer uploads screenshot
- Seller "Order not found" masking real DB errors — now surfaces actual error message
- Pre-order listings hidden when OOS — `getActiveListings` and seller page now use `.or("is_available.eq.true,is_preorder_enabled.eq.true")`
- "Open now" status badge now bold (was missing `v2-badge-bold` class; Closed/Pre-order had it)

### Changed
- Home page category strip: Surmai → Prawns → Pomfret → Crab shown first (if listings exist), then others sorted by count
- Seller page `isOpen` calculation uses IST offset for accurate open/closed display
