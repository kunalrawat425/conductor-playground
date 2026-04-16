-- Add scheduled order support to orders table
alter table orders add column if not exists scheduled_for timestamptz;
alter table orders add column if not exists schedule_slot_id uuid references seller_schedule_slots(id);

-- Add index for efficient scheduled order queries
create index if not exists idx_orders_scheduled on orders(scheduled_for) where scheduled_for is not null;
