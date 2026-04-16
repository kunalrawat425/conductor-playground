-- Allow per-gram line items (pricing_options.unit = gram) to persist on orders.
alter table public.orders drop constraint if exists orders_quantity_unit_check;

alter table public.orders
  add constraint orders_quantity_unit_check
  check (quantity_unit in ('kg', 'piece', 'dozen', 'gram'));
