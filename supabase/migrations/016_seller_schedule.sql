-- Seller schedule: config template + materialized time slots
create table if not exists seller_schedule_configs (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references sellers(id) not null unique,
  date_from date not null,
  date_to date not null,
  start_time time not null,
  end_time time not null,
  slot_duration_minutes int not null default 60,
  created_at timestamptz default now()
);

create table if not exists seller_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references sellers(id) not null,
  slot_date date not null,
  slot_start time not null,
  slot_end time not null,
  is_enabled boolean default true,
  date_disabled boolean default false,
  created_at timestamptz default now(),
  unique(seller_id, slot_date, slot_start)
);

create index idx_schedule_slots_seller_date on seller_schedule_slots(seller_id, slot_date, is_enabled);
