-- Add out_for_delivery to allowed order statuses
alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in (
    'pre_order', 'pending', 'confirmed', 'paid', 'ready_for_pickup',
    'out_for_delivery', 'picked_up', 'completed',
    'declined', 'cancelled', 'refunded', 'scheduled'
  ));
