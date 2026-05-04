# Changelog

All notable changes to Relifish are documented here.

## [0.1.1.0] - 2026-05-05

### Fixed
- **Seller open/preorder/closed logic**: simplified to three clear priority states — open by time shows order menu, closed + preorders enabled + before cutoff shows preorder menu only, otherwise shows closed with no menu
- **Pre-order cutoff enforcement**: preorder window now closes once `preorder_cutoff_time` is passed in IST; uses IST day-of-week (not UTC, which was wrong near midnight)
- **Preorder mode hidden behind closed state**: `isClosed` gate now correctly passes through to preorder menu when `isPreorderMode=true`
- **`accepts_preorder` as master switch**: when seller unchecks preorders, store never enters preorder mode regardless of per-listing `is_preorder_enabled` flags
- **Seller page location picker map**: polls for Leaflet availability instead of failing instantly; both sheet open events trigger map init
- **Buyer home location gate**: shows "Set location" prompt and skips DB fetch until buyer grants location; distance filter strictly uses seller `delivery_rad`
- **Bundle unit label**: 3-piece listings now show `/3pc` instead of `/piece` on home chips and seller menu
- **Home seller chips**: capped at 2, with `+N` badge on the 2nd chip when more listings exist
- **Closed seller menu**: seller detail page now shows locked state with opens-at time when store is closed, no menu shown

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
