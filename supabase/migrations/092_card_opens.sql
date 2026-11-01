-- Diwali card tracking (founder, 1 Nov 2026): the opens counter counted WhatsApp link previews and repeat
-- taps as opens (192 hits for 25 real people). Log each short-link hit with its time, device and a bot flag,
-- and remember which card led someone to make their own (from_card), so forwarding chains can be counted.
-- Server-only (service key): RLS on, no policies.
create table if not exists public.card_opens (
  id bigserial primary key,
  card_id text not null references public.greeting_cards(id) on delete cascade,
  at timestamptz not null default now(),
  bot boolean not null default false,
  ua text,
  referer text
);
create index if not exists card_opens_card_at_idx on public.card_opens (card_id, at);
alter table public.card_opens enable row level security;

alter table public.greeting_cards add column if not exists from_card text references public.greeting_cards(id) on delete set null;
