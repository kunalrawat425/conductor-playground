-- Delivery slots (founder, 22 Oct 2026): buyers pick a delivery time at checkout, the seller
-- can keep or change it when accepting the order or sending it out ("Arriving by").
-- Seller settings (OFF for every seller until they turn it on in Profile):
--   delivery_slot_minutes: 60 or 120. Same-day slots run inside opens_at–closes_at, starting
--     2 hours after the order; pre-order slots run preorder_delivery_start–end on the delivery date.
--   preorder_days_ahead: pre-orders can be for the next 1–3 delivery days (1 = next one only, as before).
-- Order: the chosen slot (null = no slot: pickup, or a seller with slots off).
-- Additive: apply BEFORE deploying the app code that selects these columns.
alter table public.sellers
  add column if not exists delivery_slots_enabled boolean not null default false,
  add column if not exists delivery_slot_minutes int not null default 120 check (delivery_slot_minutes in (60, 120)),
  add column if not exists preorder_delivery_start time not null default '07:00',
  add column if not exists preorder_delivery_end time not null default '13:00',
  add column if not exists preorder_days_ahead int not null default 1 check (preorder_days_ahead between 1 and 3);

alter table public.orders
  add column if not exists delivery_slot_start timestamptz,
  add column if not exists delivery_slot_end timestamptz;

comment on column public.sellers.delivery_slots_enabled is 'Buyers pick a delivery time slot at checkout (delivery orders).';
comment on column public.orders.delivery_slot_start is 'Delivery slot start (buyer pick, seller may change). Out for delivery: start of the "arriving by" window.';
comment on column public.orders.delivery_slot_end is 'Delivery slot end = "arriving by" time.';
