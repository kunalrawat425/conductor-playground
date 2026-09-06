-- 064: orders confirmed → has payment proof invariant + legacy backfill
--
-- Context: 79 rows in prod DB have `status='confirmed'` but no payment record:
--   - 50 rows: paid_amount=null, razorpay_payment_id=null, verified_at=null
--     (BUG-4 — pre-Razorpay legacy manual confirmations)
--   - 29 rows: paid_amount>0 but no verified_at (BUG-5 — accept_price /
--     seller direct confirm path, fixed in code separately)
--
-- This migration:
--   (a) backfills the 50 legacy rows with a sentinel payment_method='cod_legacy'
--       + payment_verified_at from created_at
--   (b) adds a CHECK constraint so no new rows can enter status='confirmed'
--       without one of the four proof paths
--
-- Run in order:
--   1. Apply migration (creates constraint as NOT VALID → applies only to
--      new rows)
--   2. Verify backfill: SELECT count(*) FROM orders WHERE status='confirmed'
--      AND razorpay_payment_id IS NULL AND payment_verified_at IS NULL
--      AND payment_method NOT IN ('cod_legacy');   -- expect 0
--   3. Apply VALIDATE CONSTRAINT to lock in for existing rows too

-- (a) Backfill 50 legacy pre-Razorpay confirmed orders
UPDATE orders
SET payment_method = 'cod_legacy',
    payment_verified_at = COALESCE(payment_verified_at, created_at),
    payment_verified_by = 'legacy_backfill'
WHERE status = 'confirmed'
  AND razorpay_payment_id IS NULL
  AND payment_verified_at IS NULL
  AND (paid_amount IS NULL OR paid_amount = 0)
  AND created_at < '2026-05-15';  -- Razorpay went live mid-May 2026

-- (b) 29 rows with paid_amount>0 but no verified_at — fill from created_at
-- (code fix in cancel.ts + seller/orders.ts prevents future occurrences)
UPDATE orders
SET payment_verified_at = created_at,
    payment_verified_by = COALESCE(payment_verified_by, 'legacy_backfill_paid')
WHERE status = 'confirmed'
  AND razorpay_payment_id IS NULL
  AND payment_verified_at IS NULL
  AND paid_amount > 0;

-- (c) Invariant constraint (NOT VALID = applies to new rows only until validated)
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_confirmed_needs_payment;
ALTER TABLE orders
  ADD CONSTRAINT orders_confirmed_needs_payment
  CHECK (
    status <> 'confirmed'
    OR razorpay_payment_id IS NOT NULL
    OR payment_verified_at IS NOT NULL
    OR payment_method = 'cod_legacy'
  )
  NOT VALID;

COMMENT ON CONSTRAINT orders_confirmed_needs_payment ON orders IS
  'BUG-4/5 fix: every confirmed order must have a payment record or legacy marker. Prevents 500 error surface where seller can push order to fulfillment without payment proof.';

-- After backfill verified in prod, run manually:
--   ALTER TABLE orders VALIDATE CONSTRAINT orders_confirmed_needs_payment;
