-- Diwali (and later festival) greeting cards shared from /diwali-wishes (founder, 31 Oct 2026).
-- Each shared card gets a short link /w/<id>; opening it shows "<name> sent you a card! Make yours too".
-- Server-only (service key): RLS on, no policies.
create table if not exists public.greeting_cards (
  id text primary key,
  theme text not null,
  message text not null,
  sign text not null default '',
  opens integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.greeting_cards enable row level security;
