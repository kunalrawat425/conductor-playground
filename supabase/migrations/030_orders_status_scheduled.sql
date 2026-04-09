-- Scheduled pickup orders use status = 'scheduled' (see api/orders/create.ts).
alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in (
    'pre_order', 'pending', 'confirmed', 'paid',
    'picked_up', 'completed', 'declined', 'cancelled', 'refunded', 'scheduled'
  ));
