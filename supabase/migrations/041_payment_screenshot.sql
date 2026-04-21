-- Payment screenshot upload + seller verification
-- Buyers upload proof of UPI/bank transfer; sellers verify from dashboard.

alter table orders
  add column if not exists payment_screenshot_urls text[] not null default '{}',
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_verified_by uuid references sellers(id);
-- NULL payment_verified_by = system auto-verified (price-match path)

comment on column orders.payment_screenshot_urls is 'Array of Supabase Storage URLs: order-payments/{order_id}/{filename}. Multiple files supported for partial UPI payments.';
comment on column orders.payment_verified_at is 'When seller (or system) confirmed payment';
comment on column orders.payment_verified_by is 'Seller who verified. NULL = system auto-verified on price match.';

-- Add pending_payment status so orders with no screenshot yet are distinguishable from pending orders
-- REQUIRED: verify all existing status values before running this
-- Run first: SELECT DISTINCT status FROM orders;
do $$ begin
  alter table orders drop constraint if exists orders_status_check;
  alter table orders add constraint orders_status_check
    check (status in (
      'pre_order', 'pending', 'pending_payment', 'confirmed', 'paid', 'payment_required',
      'scheduled', 'out_for_delivery', 'ready_for_pickup',
      'picked_up', 'completed', 'declined', 'cancelled', 'refunded'
    ));
exception when others then
  raise notice 'Status constraint update failed: %. Run SELECT DISTINCT status FROM orders first.', sqlerrm;
end $$;
