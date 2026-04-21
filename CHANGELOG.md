# Changelog

All notable changes to Relifish are documented here.

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
