-- Buyer rating + feedback for delivered/completed orders

create table if not exists order_feedback (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  buyer_id uuid not null references buyers(id) on delete cascade,
  seller_id uuid not null references sellers(id) on delete cascade,
  rating integer not null check (rating >= 1 and rating <= 5),
  feedback text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, buyer_id)
);

create index if not exists idx_order_feedback_seller_id on order_feedback(seller_id);
create index if not exists idx_order_feedback_order_id on order_feedback(order_id);

alter table order_feedback enable row level security;

drop policy if exists "Anyone can view order feedback" on order_feedback;
create policy "Anyone can view order feedback"
  on order_feedback for select using (true);

