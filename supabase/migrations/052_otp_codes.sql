-- OTP codes table: self-managed OTP with rate limits
-- Replaces the scattered otp_attempts logic; works with MSG91 or any SMS provider.
create table if not exists otp_codes (
  phone           text primary key,
  code            text not null,                          -- 6-digit OTP (plain, server-key-only readable)
  expires_at      timestamptz not null,                   -- code expires after 10 minutes
  verify_attempts int not null default 0,                 -- wrong guesses for current code (max 3)
  sends_today     int not null default 0,                 -- SMS sends today (max 3, resets at IST midnight)
  send_date       date not null default current_date,     -- IST date of last send
  last_sent_at    timestamptz not null default now(),     -- for 30-second cooldown
  created_at      timestamptz not null default now()
);

-- Only service-role can read/write (RLS off for service key, on for anon)
alter table otp_codes enable row level security;
-- No public access — API routes use service key only
create policy "service_only" on otp_codes for all using (false);
