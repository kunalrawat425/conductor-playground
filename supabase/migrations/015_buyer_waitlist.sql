-- Buyer waitlist: captures demand before sellers go live in an area
create table if not exists buyer_waitlist (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid references buyers(id),
  phone text not null,
  area text not null,
  fish_wanted text,
  frequency text,
  preference text,
  budget text,
  notes text,
  email_sent boolean default false,
  converted_at timestamptz,
  created_at timestamptz default now(),
  unique(phone, area)
);

create index idx_waitlist_area on buyer_waitlist(area);
create index idx_waitlist_created on buyer_waitlist(created_at desc);
