# Changelog

All notable changes to Relifish are documented here.

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
