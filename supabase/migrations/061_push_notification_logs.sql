-- Create push_notification_logs table to track sent notifications, what was sent, and delivery status
create table if not exists push_notification_logs (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid references buyers(id) on delete cascade,
  title text not null,
  body text not null,
  url text not null,
  status text not null, -- 'success' or 'failed'
  error_message text default null,
  created_at timestamptz default now()
);

create index if not exists idx_push_notification_logs_buyer on push_notification_logs(buyer_id);
create index if not exists idx_push_notification_logs_created on push_notification_logs(created_at desc);
