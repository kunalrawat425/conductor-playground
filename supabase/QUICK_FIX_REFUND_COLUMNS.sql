-- Run this once on environments throwing:
-- "Could not find the 'refund_note' column of 'orders' in the schema cache"
--
-- This is safe and idempotent.

alter table public.orders
  add column if not exists refund_note text,
  add column if not exists refund_sent_at timestamptz,
  add column if not exists refund_screenshot_path text;

comment on column public.orders.refund_note is
  'Seller note when marking refund as sent (e.g. UTR number or message)';
comment on column public.orders.refund_sent_at is
  'Timestamp when seller marked refund as sent to buyer';
comment on column public.orders.refund_screenshot_path is
  'Storage path of seller-uploaded refund proof screenshot (order-payments bucket)';
