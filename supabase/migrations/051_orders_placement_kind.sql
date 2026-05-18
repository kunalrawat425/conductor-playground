-- Persist how the order was placed: same-day (open hours) vs pre-order (closed + preorder window).
alter table orders
  add column if not exists placement_kind text
  check (placement_kind is null or placement_kind in ('same_day', 'preorder'));

comment on column orders.placement_kind is
  'same_day = placed while seller open; preorder = placed in pre-order shopping window (timing only).';
