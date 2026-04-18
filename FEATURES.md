# Relifish V2 — Feature List & Screen Map

**Source of truth for QA, product review, and feature planning.**
Last updated: 2026-04-18

---

## BUYER SCREENS

### 1. Home (`/v2`)

| Feature | Status | Notes |
|---------|--------|-------|
| Sticky header (logo, location, theme toggle, profile icon) | ✅ | `position: sticky; top: 0` |
| Location picker (geolocation + manual via Leaflet map) | ✅ | Opens `LocationPickerSheet` on header tap |
| Auto-prompt geolocation on first visit | ✅ | `sessionStorage` prevents re-prompt |
| Pre-order banner (inline, links to `/v2/preorder`) | ✅ | Dynamic `opens_at` per seller |
| Category strip (All Fish / Prawns / Crab / Squid / Shellfish) | ✅ | Client-side species filter |
| Filter chips (All / Open now / Pre-order / Pickup / Delivery / Top rated) | ✅ | Toggleable, URL-seeded via `?mode=` |
| URL deep-link: `?mode=preorder`, `?species=prawns` | ✅ | Pre-seeds filter state on load |
| Sticky filter cluster (pins below header on scroll) | ✅ | `overflow-x: clip` fix for sticky |
| Seller cards with status badges (Open / Closed / Pre-order) | ✅ | SSR from Supabase |
| Cross-midnight `isOpen()` (e.g. 17:00→01:58) | ✅ | Wraps around midnight correctly |
| Distance filter (25km cap when location set) | ✅ | Haversine distance calc |
| Notification permission prompt (after location accepted) | ✅ | `Notification.requestPermission()` |
| Dark mode toggle in header | ✅ | `data-theme` attr, localStorage persist |
| Empty state: "Markets closed" → pre-order CTA | ✅ | Links to `/v2?mode=preorder` |
| Empty state: "Not in your area" → waitlist | ✅ | Links to `/buyer-banner.html` |
| Bottom nav: Home / Orders / Account | ✅ | 3 items |

### 2. Seller Page (`/v2/seller/[id]`)

| Feature | Status | Notes |
|---------|--------|-------|
| Seller hero (name, location, rating, status, hours, tags) | ✅ | SSR |
| Formatted time display ("Opens 5 AM" not "05:00:00") | ✅ | `fmtTime()` helper |
| Today's Menu grid (2-col, 3-col on desktop) | ✅ | Filtered `is_available=true` |
| Single pricing tier: compact card with + button | ✅ | `pricing_options[0]` |
| Multiple pricing tiers: row per tier with individual + buttons | ✅ | Shows label, price, bundle size |
| `pricing_option_id` tracked through cart → checkout → API | ✅ | Prevents wrong-tier fallback |
| Add to cart → global cart (`v2_cart_global` localStorage) | ✅ | Single seller enforced |
| Cart bar (item count, subtotal, min-order gate, free delivery badge) | ✅ | Current seller only |
| Single-seller cart enforcement (adding from new seller clears old) | ✅ | Toast on switch |
| Call Seller button (📞 `tel:` link in hero) | ✅ | Shows when seller has phone |
| WhatsApp Seller button (💬 `wa.me/` link in hero) | ✅ | Opens WhatsApp with seller number |
| Checkout → 2-step (cart review → delivery/address + place order) | ✅ | Payment step commented out |
| Delivery/Pickup radio toggle | ✅ | Hidden if `has_delivery=false` |
| Delivery fee preview (live estimate when delivery selected) | ✅ | ₹40 flat / FREE above threshold |
| Address picker (bottom sheet, saved addresses) | ✅ | `v2-address-confirmed` event |
| Place order → POST `/api/orders/create-seller-cart` | ✅ | Atomic via `create_order_atomic` RPC |
| Inventory check at order time (`weight_avail FOR UPDATE`) | ✅ | Returns "Only X in stock" on fail |
| Cart sync to server (POST `/api/buyer/cart` on every mutation) | ✅ | Guest = local only |
| Pre-order item tag (weight_avail=0 + accepts_preorder) | ✅ | Purple badge |
| Login required for checkout (opens LoginSheet) | ✅ | Redirects back after OTP |

### 3. Account (`/v2/me`)

| Feature | Status | Notes |
|---------|--------|-------|
| Guest state: sign-in prompt with LoginSheet | ✅ | OTP via Twilio |
| Profile hero (name, phone, "Edit profile" button) | ✅ | Blue gradient |
| Edit profile bottom sheet (first name, last name, email) | ✅ | POST `/api/buyer/profile` |
| Quick actions: Addresses / Orders / Notifications / Help | ✅ | 4-grid |
| Saved addresses list (label, text, default badge) | ✅ | GET `/api/buyer/addresses` |
| Set default address (⭐ button) | ✅ | PATCH `/api/buyer/addresses` |
| Delete address (🗑 button with confirm) | ✅ | DELETE `/api/buyer/addresses` |
| Add new address (opens AddressPickerSheet) | ✅ | Leaflet map + form |
| Theme toggle (switch to dark mode) | ✅ | `ThemeToggle` component |
| Terms & Privacy link | ✅ | → `/v2/privacy` |
| Log out (clears localStorage, redirects to `/v2`) | ✅ | Clears buyer + cart keys |

### 4. Orders List (`/v2/track`)

| Feature | Status | Notes |
|---------|--------|-------|
| Guest state: sign-in prompt | ✅ | LoginSheet |
| Active order card (stepper: Placed→Confirmed→Ready→Done) | ✅ | Clickable → detail |
| Past orders list with pagination (10/page) | ✅ | Client-side pagination |
| Order row: seller name, date, species, status badge, total | ✅ | Links to `/v2/track/[id]` |
| "View →" button on past orders | ✅ | Navigates to detail |
| Real-time polling (20s when active orders exist) | ✅ | `setInterval` |

### 5. Order Detail (`/v2/track/[id]`)

| Feature | Status | Notes |
|---------|--------|-------|
| Status hero (colored badge, order ID, timestamp) | ✅ | Blue gradient |
| 4-step tracker (Placed→Confirmed→Ready→Done) | ✅ | Green dots |
| Seller card with tap-to-call (📞) | ✅ | `tel:` link |
| Items list (species, quantity, price per line) | ✅ | From order + listing |
| Delivery/Pickup block (full address if delivery) | ✅ | From `buyer_addresses` |
| Bill summary (subtotal, delivery fee, total, payment method) | ✅ | COD / UPI |
| Cancel button (pending/pre_order only) | ✅ | POST `/api/orders/cancel` |
| Re-order button (completed/cancelled orders) | ✅ | Dumps items into cart → seller page |
| Real-time polling (15s while order active) | ✅ | Stops at terminal state |

### 6. Pre-order Index (`/v2/preorder`)

| Feature | Status | Notes |
|---------|--------|-------|
| Popular species grid (8 species with emoji + Marathi names) | ✅ | Static list |
| Sellers accepting pre-orders (cards with dynamic "Ready Xam" badge) | ✅ | Uses seller's `opens_at` |
| Empty state: "Join waitlist" link | ✅ | → `/buyer-banner.html` |

### 7. Pre-order Wizard (`/v2/preorder/[species]`)

| Feature | Status | Notes |
|---------|--------|-------|
| Step 1: Pick a seller (button list with rating, tags) | ✅ | SSR from DB |
| Step 2: Quantity (± buttons, cut style radios, special notes) | ✅ | 0.5 increment |
| Step 3: Pickup time slots (dynamic from seller's opens_at→closes_at) | ✅ | 2-hour increments |
| Step 4: Review + Reserve (real estimate from seller's pricing) | ✅ | Falls back to "Seller confirms" |
| Error toast on POST failure | ✅ | `v2Toast("error", ...)` |
| Login required (opens LoginSheet if not signed in) | ✅ | Redirects back |

### 8. Search (`/v2/search`)

| Feature | Status | Notes |
|---------|--------|-------|
| Search input with debounce (300ms) | ✅ | GET `/api/search` |
| Trending species cards (6 items) | ✅ | Links to `/?species=X` |
| Results: listings (species + seller + price) + sellers (name + location) | ✅ | Links to seller page |
| Error toast on API failure | ✅ | try/catch + toast |
| Clear button (× resets to trending) | ✅ | |

### 9. Privacy (`/v2/privacy`)

| Feature | Status | Notes |
|---------|--------|-------|
| Static privacy policy text | ✅ | Last updated April 2026 |
| Contact email link | ✅ | `mailto:` |

---

## SELLER SCREENS

### 10. Seller Login (`/v2/dashboard/login`)

| Feature | Status | Notes |
|---------|--------|-------|
| "Sign in with phone" button → LoginSheet auto-opens | ✅ | 300ms delay |
| OTP flow (send → verify → create/find seller) | ✅ | New sellers: `is_active=false` |
| "Back to buyer app" link | ✅ | → `/v2` |

### 11. Orders Dashboard (`/v2/dashboard/orders`)

| Feature | Status | Notes |
|---------|--------|-------|
| Hero: greeting, "Today's pipeline" stats (New / GMV / Pre-orders) | ✅ | Today's snapshot |
| "✓ Mark all ready" batch button (fans out confirm for all pending) | ✅ | Promise.all, partial-success |
| "+ Listing" quick link | ✅ | → `/v2/dashboard/listings/new` |
| 3 tabs: Pending / Accepted / Completed | ✅ | Status-scoped |
| Date range filter (today / 7d / 30d / all) | ✅ | Server-side via Supabase |
| Server-side pagination (20/page, Prev/Next) | ✅ | `.range()` + count |
| Order cards with Accept/Decline buttons + loading states | ✅ | Disables on click |
| Export CSV link (⬇ CSV) | ✅ | GET `/api/seller/orders-export` |
| Real-time polling (10s on pending tab) | ✅ | `setInterval` |
| Account pending activation state | ✅ | EmptyState with Refresh + Sign out |
| Sign out from pending state | ✅ | Clears seller localStorage |
| No-auth state (sign-in required) | ✅ | EmptyState with login CTA |

### 12. Listings (`/v2/dashboard/listings`)

| Feature | Status | Notes |
|---------|--------|-------|
| "+ Add new listing" button | ✅ | → `/v2/dashboard/listings/new` |
| Listing cards (species, price, stock, photo) | ✅ | Defensive `deleted_at` fallback |
| Edit button per listing | ✅ | → `/v2/dashboard/listings/[id]` |
| Pause/Resume toggle (optimistic UI, rollback on error) | ✅ | "PAUSED" label |
| Delete button (🗑 with confirm, soft-delete) | ✅ | Sets `is_available=false` + `weight_avail=0` |
| Empty state: "No listings yet" CTA | ✅ | → create listing |

### 13. New Listing (`/v2/dashboard/listings/new`)

| Feature | Status | Notes |
|---------|--------|-------|
| ListingForm component (shared with edit) | ✅ | V1 form with V2 CSS overrides |
| sellerId hydrated from localStorage | ✅ | `<script>` sets `data-seller-id` |
| Species dropdown | ✅ | From `SPECIES_LIST` |
| Pricing tiers: "Per piece" or "Per kg" basis selector | ✅ | Enforces uniform unit |
| Multiple pricing tiers (+ Add another price) | ✅ | bundle_size support |
| Stock input (unit-aware label) | ✅ | Changes "pieces" / "kg" |
| Validation: prices ≥ ₹1, uniform units, at least 1 tier | ✅ | Client + server |

### 14. Edit Listing (`/v2/dashboard/listings/[id]`)

| Feature | Status | Notes |
|---------|--------|-------|
| Pre-populated ListingForm from DB | ✅ | SSR via `getListingById` |
| Client-side ownership check | ✅ | Shows "access denied" if seller mismatch |
| Same pricing/stock controls as new listing | ✅ | Shared component |

### 15. Seller Profile (`/v2/dashboard/profile`)

| Feature | Status | Notes |
|---------|--------|-------|
| Business name (required) | ✅ | |
| Area / Neighborhood | ✅ | |
| Owner contact: First name, Last name, Email | ✅ | DB columns from migration 008 |
| Operating hours (Opens/Closes time pickers) | ✅ | Cross-midnight allowed |
| Minimum order (₹) | ✅ | |
| Accept pre-orders toggle 🌙 | ✅ | |
| Offer delivery toggle 🚲 | ✅ | Collapsible sub-settings |
| Delivery radius (km) | ✅ | Nested under delivery toggle |
| Delivery fee (₹) | ✅ | Nested under delivery toggle |
| Free delivery above (₹ threshold) | ✅ | Nested under delivery toggle |
| Phone display (read-only, set at signup) | ✅ | |
| Save changes with validation | ✅ | Cross-midnight OK, email regex |
| Time validation: rejects opens === closes only | ✅ | Was too strict before |

### 16. Pre-orders (`/v2/dashboard/pending`)

| Feature | Status | Notes |
|---------|--------|-------|
| Pending activation screen | ✅ | Shows when `is_active=false` |
| Refresh status button | ✅ | `location.reload()` |
| Sign out link | ✅ | Clears seller localStorage |

---

## API ENDPOINTS

### Buyer APIs

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/auth/send-otp` | POST | Send OTP via Twilio | ✅ |
| `/api/auth/verify-otp` | POST | Verify OTP, create/find buyer/seller (phone stripped from response) | ✅ |
| `/api/buyer/profile` | GET | Fetch buyer profile (name, email) | ✅ |
| `/api/buyer/profile` | POST | Update first_name, last_name, email | ✅ |
| `/api/buyer/addresses` | GET | List saved addresses | ✅ |
| `/api/buyer/addresses` | POST | Add new address | ✅ |
| `/api/buyer/addresses` | PATCH | Update address (set default, edit) | ✅ |
| `/api/buyer/addresses` | DELETE | Remove address | ✅ |
| `/api/buyer/cart` | GET | Fetch server-side cart (signed-in only) | ✅ |
| `/api/buyer/cart` | POST | Upsert cart line | ✅ |
| `/api/buyer/cart` | DELETE | Remove item / clear cart | ✅ |
| `/api/buyer/push-subscribe` | POST | Save push subscription | ✅ |

### Order APIs

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/orders/create` | POST | Create single-item order (preorder wizard) | ✅ |
| `/api/orders/create-seller-cart` | POST | Create multi-line order from cart | ✅ |
| `/api/orders/detail` | GET | Fetch order detail (buyer auth) | ✅ |
| `/api/orders/cancel` | POST | Cancel/reject order | ✅ |

### Seller APIs

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/seller/profile` | POST | Update seller profile fields | ✅ |
| `/api/seller/orders` | POST | Accept/decline order | ✅ |
| `/api/seller/orders-export` | GET | Download orders as CSV | ✅ |
| `/api/seller/listings` | POST | Create/update/delete listing | ✅ |
| `/api/seller/schedule` | POST | Manage pickup slots (API only, no UI) | ✅ |

### Utility APIs

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/search` | GET | Search listings + sellers (ILIKE) | ✅ |
| `/api/categories` | GET | Hardcoded category list | ✅ |
| `/api/sellers/nearby` | GET | Aggregate seller stats | ✅ |
| `/api/preorders` | GET | Buyer's pre-orders list | ✅ |
| `/api/notify-seller` | POST | Push notification to seller on new order | ✅ |

---

## DATABASE TABLES

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `sellers` | Seller accounts | name, phone, opens_at, closes_at, has_delivery, delivery_fee_amount, free_delivery_above, accepts_preorder, min_order_amount, is_active |
| `buyers` | Buyer accounts | phone, first_name, last_name, email |
| `fish_listings` | Menu items | seller_id, species, pricing_options (JSONB), weight_avail, is_available, deleted_at |
| `orders` | All orders | listing_id, buyer_phone, buyer_id, status, quantity, total_price, delivery_fee, order_type, pricing_option_id |
| `buyer_addresses` | Saved addresses | buyer_id, label, flat, building, landmark, location_name, lat, lng, is_default |
| `buyer_cart` | Server-side cart | buyer_id, listing_id, qty, qty_unit, price_snapshot |

---

## INVENTORY & PRICING

| Feature | Implementation | Status |
|---------|---------------|--------|
| Atomic stock decrement | `create_order_atomic` RPC with `FOR UPDATE` lock | ✅ |
| Stock check before order | `IF v_avail < p_quantity THEN RAISE EXCEPTION` | ✅ |
| Multiple pricing tiers per listing | `pricing_options` JSONB array, per-tier +/counter in menu | ✅ |
| Uniform unit enforcement | All tiers must be same unit (piece OR kg) | ✅ |
| Bundle size support | `bundle_size` field — cart adds qty in bundle units (e.g. 4pc pack = qty 4) | ✅ |
| Bundle qty validation | API requires qty multiple of bundle_size, +/- step by bundle_size | ✅ |
| Compare-at-price (discount) | Strikethrough ~~₹was~~ ₹now + -X% red badge on card | ✅ |
| Fish size display | S/M/L badge next to species name on buyer menu | ✅ |
| Low stock warning | "⚡ Stock clearing soon" when stock ≤ oos_threshold | ✅ |
| Daily qty limit hint | "Max X per buyer/day" shown on menu card | ✅ |
| Photo support | Real image renders when seller uploaded photo_url | ✅ |
| Composite cart key | `listing_id:pricing_option_id` — different tiers = separate cart lines | ✅ |
| Pack counter display | Shows `1×4` notation for bundle packs in cart counter | ✅ |
| Pricing option tracked through cart → order | `pricing_option_id` in CartItem + order lines | ✅ |
| Cart sync (polling on page load) | `hydrateFromServer()` + `pushLocalToServer()` | ✅ |
| Single-seller cart | Adding from different seller clears old cart | ✅ |
| Pre-order notes + cut style | `buyer_notes` + `cut_style` saved to orders table (migration 036) | ✅ |
| Conditional pickup slots | Only renders when seller has `schedule_pickup_slots=true` | ✅ |

## SELLER CARD UX (HOME PAGE)

| Seller State | Card Appearance | Badge |
|---|---|---|
| Open + has items | Normal card | "Open now" (green) + "Pre-order" if accepts |
| Open + no items + accepts preorder | Normal card | "Pre-order only" (indigo) |
| Closed + accepts preorder | **Normal card (NOT greyed)** | "🌙 Pre-order open" (indigo) |
| Closed + no preorder | Grey card | "Closed" (red) |

---

## PRIVACY & SECURITY

| Rule | Implementation | Status |
|------|---------------|--------|
| Buyer phone never in API responses | Stripped from verify-otp, order emails | ✅ |
| Buyer phone never in seller emails | `buyerPhone` removed from `orderEmailSeller()` | ✅ |
| Buyer phone visible only on own profile | `/v2/me` shows own phone from localStorage | ✅ |
| Seller phone shown to buyers | Call Seller + WhatsApp buttons on seller page | ✅ |
| Design mockups use masked numbers | `+91 98XXX XXXXX` in all design HTML files | ✅ |

---

## DESIGN SYSTEM

| Token | Value |
|-------|-------|
| Font | Inter (variable) |
| Brand color | `--v2-brand: #0066FF` |
| Indigo (pre-order) | `--v2-indigo: #4F46E5`, `-l: #EEF2FF`, `-m: #E0E7FF`, `-d: #3730A3` |
| Border radius | `--v2-radius: 12px`, `--v2-radius-sm: 8px`, `--v2-radius-lg: 16px` |
| Shadows | `--v2-shadow-sm/shadow/shadow-md/shadow-lg` |
| Z-layers | header:50, bottom-nav:40, cart-bar:45, modal:100, toast:200 |
| Motion | `--v2-ease: cubic-bezier(.4,0,.2,1)`, dur-fast:150ms, dur:250ms, dur-slow:400ms |
| Dark mode | `[data-theme="dark"]` + `@media (prefers-color-scheme: dark)` |
| Bottom sheet | `BottomSheet.astro` with backdrop blur + 85% opacity |
| Toast | `window.v2Toast(type, title, msg)` — warning+error: 6s, success+info: 4s |
| Sheet control | `window.v2OpenSheet(id)` / `v2CloseSheet(id)` |
| Cart module | `window.RelifishCart` (global, from AppShellV2) |

---

## PENDING MIGRATIONS (apply in Supabase SQL editor)

```sql
-- Migration 035: soft-delete for listings
ALTER TABLE fish_listings ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_fish_listings_deleted_at ON fish_listings(deleted_at);
```

---

## DEFERRED / FUTURE

| Feature | Priority | Notes |
|---------|----------|-------|
| Cart expiry (auto-clear after 24h) | Low | |
| UPI/online payment integration | Medium | Payment step commented out, COD only |
| Save for later | Low | |
| Cart sharing via QR | Low | |
| Seller analytics/stats page | Medium | API exists, no UI |
| Pickup slot calendar (buyer-facing) | Medium | API + DB exists, no UI |
| Push notification management in profile | Low | Permission prompt works, no settings page |
| Low stock alerts for sellers | Low | `low_stock_threshold` column exists |
| Seller account self-deactivation | Low | `is_active` column exists |
| Image upload for listings | Medium | `photo_url` column exists, no upload UI |
