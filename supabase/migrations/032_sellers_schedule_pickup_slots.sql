-- Buyer menu: explicit flag so pickup slots hide when seller turns scheduling off,
-- even if a seller_schedule_configs row was not deleted.
alter table public.sellers
  add column if not exists schedule_pickup_slots boolean not null default false;

comment on column public.sellers.schedule_pickup_slots is
  'When true, buyers may see pickup time slots (requires seller_schedule_configs).';

update public.sellers s
set schedule_pickup_slots = true
from public.seller_schedule_configs c
where c.seller_id = s.id;
