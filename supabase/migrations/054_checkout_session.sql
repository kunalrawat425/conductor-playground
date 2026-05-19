-- Group orders from the same cart checkout together.
-- Existing rows get NULL — rendered as individual cards, no backfill needed.
alter table orders
  add column if not exists checkout_session_id uuid;

create index if not exists orders_checkout_session_idx
  on orders (checkout_session_id)
  where checkout_session_id is not null;
