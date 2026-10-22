-- Delivery-slot settings for the two live sellers (founder, 22 Oct 2026).
-- Run on PROD only AFTER migration 084_delivery_slots.sql is applied and the PR is deployed.
-- Not a migration: one-off data. Back up first, restore with the last statement if needed.

-- 1. Backup
create table if not exists public.backup_20261022_slot_settings as
  select id, name, delivery_slots_enabled, delivery_slot_minutes, preorder_delivery_start, preorder_delivery_end, preorder_days_ahead
  from public.sellers
  where id in ('2f39dfce-15c0-4f9a-a5b3-e95280479dbd', 'bd8efaae-69e1-4dcb-bdcb-75d1874b96ed');

-- 2. Fishtokri: 2-hour slots; same-day inside its 08:00–18:00 hours; pre-orders delivered 8–10, 10–12;
--    buyers can pre-order for the next 3 delivery days.
update public.sellers set
  delivery_slots_enabled = true, delivery_slot_minutes = 120,
  preorder_delivery_start = '08:00', preorder_delivery_end = '12:00', preorder_days_ahead = 3
where id = '2f39dfce-15c0-4f9a-a5b3-e95280479dbd';

-- 3. The Nomadic Catch: pre-order only; slots 7–9, 9–11, 11–1 on Tue/Sat; next 2 delivery days
--    (buyers always see the next Tue and the next Sat).
update public.sellers set
  delivery_slots_enabled = true, delivery_slot_minutes = 120,
  preorder_delivery_start = '07:00', preorder_delivery_end = '13:00', preorder_days_ahead = 2
where id = 'bd8efaae-69e1-4dcb-bdcb-75d1874b96ed';

-- Check
select id, name, delivery_slots_enabled, delivery_slot_minutes, preorder_delivery_start, preorder_delivery_end, preorder_days_ahead
from public.sellers where id in ('2f39dfce-15c0-4f9a-a5b3-e95280479dbd', 'bd8efaae-69e1-4dcb-bdcb-75d1874b96ed');

-- Restore (only if needed):
-- update public.sellers s set delivery_slots_enabled = b.delivery_slots_enabled, delivery_slot_minutes = b.delivery_slot_minutes,
--   preorder_delivery_start = b.preorder_delivery_start, preorder_delivery_end = b.preorder_delivery_end, preorder_days_ahead = b.preorder_days_ahead
-- from public.backup_20261022_slot_settings b where s.id = b.id;
