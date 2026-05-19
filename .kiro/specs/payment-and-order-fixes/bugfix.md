# Bugfix Requirements Document

## Introduction

This document covers four bugs affecting the payment and order management flows in the Relifish marketplace:

1. **Razorpay "order not found" error** — The `/api/payments/razorpay-create-order` endpoint returns "Order not found" for valid orders, blocking buyers from initiating Razorpay payment.
2. **Prices shown in flyer.html** — The public flyer page fetches and displays live fish prices from the database, which should instead be removed in favour of a prompt to check live prices and log in.
3. **Order and pre-order tags not clearly visible** — In both the seller dashboard and buyer order list, the "Order" / "Pre-order" type tags are visually indistinct, and the "Live" label shown to buyers on active orders is ambiguous.
4. **Razorpay payment flow incorrectly asks seller to verify screenshot** — When an order is paid via Razorpay (auto-confirmed by the system), the seller dashboard still shows the "Awaiting buyer payment screenshot / Verify & Confirm" flow, which is only appropriate for manual UPI/bank-transfer payments.

---

## Bug Analysis

### Current Behavior (Defect)

**Bug 1 — Razorpay "order not found"**

1.1 WHEN a buyer calls `POST /api/payments/razorpay-create-order` with a valid `order_id` and matching `buyer_id` THEN the system returns HTTP 404 with `{"error": "Order not found"}` even though the order exists in the database.

1.2 WHEN the `razorpay-create-order` endpoint queries the `orders` table using `.eq("id", order_id).single()` THEN the system fails to find the row because the `buyer_id` column on the order is `null` (orders created without a logged-in buyer account have no `buyer_id`) and the subsequent ownership check `order.buyer_id !== buyer_id` causes a mismatch, or the Supabase service-key query itself returns no row due to a missing column in the select or a schema mismatch.

**Bug 2 — Prices shown in flyer.html**

1.3 WHEN a user opens `public/flyer.html` THEN the system fetches live fish prices from Supabase and displays them in the fish-species grid cards (e.g. "₹450/kg" for Pomfret).

1.4 WHEN the Supabase price fetch in `flyer.html` succeeds THEN the system populates `.fc-price` elements with formatted price strings, making the flyer show specific prices that may be stale or misleading.

**Bug 3 — Order and pre-order tags not clearly visible**

1.5 WHEN a seller views an order card in the dashboard order list THEN the "Order" or "Pre-order" type pill (`.v2-oc-meta-pill`) is rendered with a low-contrast grey background and grey text, making it visually indistinct from other metadata pills.

1.6 WHEN a buyer views their active order list on `/track` THEN the order type label shown is "Live" for same-day orders, which does not clearly communicate to the buyer whether the order is a regular same-day order or a pre-order.

**Bug 4 — Razorpay-paid orders show screenshot verification flow to seller**

1.7 WHEN an order is paid via Razorpay and the system auto-confirms it (setting `status = "confirmed"` and `payment_method = "razorpay"` and `payment_verified_at` to a non-null timestamp) THEN the seller dashboard still shows the "Awaiting buyer payment screenshot" message and the disabled "✓ Verify & Confirm" button for orders in `pending`, `pending_payment`, `scheduled`, or `pre_order` status — because the dashboard does not check `payment_method` or `payment_verified_at` before rendering the screenshot-verification UI.

1.8 WHEN a Razorpay-paid order transitions to `confirmed` status via the `razorpay-verify` endpoint THEN the system does not re-enter the `pending`/`pending_payment` states, so the screenshot flow should not appear — but if the order was in `pending_payment` before Razorpay payment and the seller views it before the status update propagates, the seller sees the wrong UI.

---

### Expected Behavior (Correct)

**Bug 1 — Razorpay "order not found"**

2.1 WHEN a buyer calls `POST /api/payments/razorpay-create-order` with a valid `order_id` and a `buyer_id` that matches the `buyer_id` stored on the order THEN the system SHALL return HTTP 200 with the Razorpay order details (or create a new Razorpay order if one does not yet exist).

2.2 WHEN the `buyer_id` on the order is `null` (guest/phone-only order) and the caller provides a `buyer_id` THEN the system SHALL return HTTP 403 Unauthorized rather than HTTP 404 "Order not found", so the error is accurate and the order is not silently hidden.

**Bug 2 — Prices shown in flyer.html**

2.3 WHEN a user opens `public/flyer.html` THEN the system SHALL NOT display any specific fish prices in the species grid cards.

2.4 WHEN the fish-species grid cards are rendered in `flyer.html` THEN the system SHALL display a call-to-action prompt (e.g. "Check live prices → relifish.store/shop") in place of the price field, and the JavaScript price-fetching script SHALL be removed or disabled.

**Bug 3 — Order and pre-order tags not clearly visible**

2.5 WHEN a seller views an order card in the dashboard order list THEN the system SHALL render the "Pre-order" type pill with a visually distinct style (e.g. purple/indigo background with white or dark text) that clearly differentiates it from the "Order" pill and from other metadata pills.

2.6 WHEN a seller views an order card in the dashboard order list THEN the system SHALL render the "Order" type pill with a visually distinct style (e.g. blue/brand background with white or dark text) that clearly differentiates it from the "Pre-order" pill.

2.7 WHEN a buyer views their active order list on `/track` THEN the system SHALL display "Same-day order" (or equivalent clear label) instead of "Live" for regular same-day orders, so the buyer understands the order type without ambiguity.

**Bug 4 — Razorpay-paid orders show screenshot verification flow to seller**

2.8 WHEN an order has `payment_method = "razorpay"` OR `payment_verified_at` is non-null (system auto-verified) THEN the system SHALL NOT show the "Awaiting buyer payment screenshot" message or the "✓ Verify & Confirm" button to the seller.

2.9 WHEN an order has `payment_method = "razorpay"` and `status = "confirmed"` THEN the system SHALL show the seller the normal fulfillment actions (e.g. "📦 Ready for pickup" or "🚲 Out for delivery") directly, without any screenshot-verification step.

---

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a buyer calls `POST /api/payments/razorpay-create-order` with a `buyer_id` that does NOT match the order's `buyer_id` THEN the system SHALL CONTINUE TO return HTTP 403 Unauthorized.

3.2 WHEN a buyer calls `POST /api/payments/razorpay-create-order` for an order whose status is not `pending` or `pending_payment` THEN the system SHALL CONTINUE TO return HTTP 400 with an appropriate error message.

3.3 WHEN `PUBLIC_ENABLE_RAZORPAY` is not `"true"` THEN the system SHALL CONTINUE TO return HTTP 400 "Razorpay is not enabled" from the `razorpay-create-order` endpoint.

3.4 WHEN a buyer uploads a UPI payment screenshot for a manual (non-Razorpay) order THEN the system SHALL CONTINUE TO show the seller the "Buyer uploaded payment proof" section and the enabled "✓ Verify & Confirm" button.

3.5 WHEN a seller views a manual-payment order in `pending` or `pending_payment` status with no screenshot uploaded THEN the system SHALL CONTINUE TO show the "Awaiting buyer payment screenshot" message and the disabled "✓ Verify & Confirm" button.

3.6 WHEN a user prints or views `public/flyer.html` THEN the system SHALL CONTINUE TO display all other flyer content (hero, modes, steps, QR code, social proof, support card) unchanged.

3.7 WHEN a seller views a pre-order card in the dashboard THEN the system SHALL CONTINUE TO show the pre-order price entry input and the pre-order-specific UI elements.

3.8 WHEN a buyer views a terminated order (declined, cancelled, refunded) in `/track` THEN the system SHALL CONTINUE TO display the terminated state styling and refund note unchanged.

3.9 WHEN a seller views an order card in the dashboard THEN the system SHALL CONTINUE TO show the delivery/pickup type pill alongside the order/pre-order type pill.

3.10 WHEN a Razorpay payment is verified via `POST /api/payments/razorpay-verify` THEN the system SHALL CONTINUE TO auto-confirm the order, set `payment_method = "razorpay"`, set `payment_verified_at`, and send the buyer a receipt email.
