-- Add is_preorder boolean to orders table.
-- TRUE  = order placed while seller was closed (pre-order window, before cutoff).
-- FALSE = order placed while seller was open (same-day order).
-- NULL  = legacy orders created before this column existed (treat as same-day).

alter table orders
  add column if not exists is_preorder boolean default false;

comment on column orders.is_preorder is 'TRUE if order was placed during pre-order window (seller closed, before cutoff). FALSE or NULL = same-day order placed while seller was open.';
