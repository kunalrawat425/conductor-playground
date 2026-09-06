-- PRODUCTION ONLY. Do NOT run this on staging.
--
-- Under the old production behaviour every INSERT deducted stock — including
-- `pending_payment`, which staging correctly skips — but nothing recorded that
-- it had happened. After 067 installs the correct triggers, still-live orders
-- must be marked as deducted, for two separate reasons:
--
--   a) a later cancellation returns their stock (without this they keep leaking)
--   b) confirming a pending_payment row will NOT deduct a second time, because
--      the on-confirm guard requires OLD.inventory_deducted = false
--
-- (b) is the dangerous one: skip this backfill on production and every
-- pending_payment order that later gets confirmed is charged stock twice.
--
-- Running this on STAGING would be wrong — there, pending_payment rows never
-- had stock deducted, so marking them true makes a cancellation invent stock.
--
-- Terminal rows are deliberately untouched. Their stock was lost long ago;
-- handing it back now would overstate what the seller actually has.

update orders
set inventory_deducted = true
where inventory_deducted is not true
  and listing_id is not null
  and status in (
    'pending', 'pending_payment', 'payment_required', 'pre_order',
    'scheduled', 'confirmed', 'paid', 'ready_for_pickup', 'out_for_delivery'
  );

-- Rollback: update orders set inventory_deducted = false where <same predicate>;
