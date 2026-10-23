-- 086: WhatsApp messaging engine (plan: .claude/plans, founder 24 Oct 2026).
-- message_log: one row per message we decide to send (or would send in dry-run). The unique
-- dedupe_key makes every send idempotent: a re-run of the 30-min job or a duplicate webhook
-- can never send the same message twice. Consent columns: promos go only to buyers who ticked
-- the WhatsApp box (whatsapp_opt_in_at) and never after "Stop updates" (whatsapp_opt_out_at).

create table if not exists public.message_log (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  buyer_id uuid references public.buyers(id) on delete cascade,
  seller_id uuid references public.sellers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  kind text not null,          -- A1, A2, B1, B2, weekend, order_paid, order_confirmed, ..., seller_new_order, seller_waiting
  channel text not null,       -- whatsapp | push
  template text,
  to_phone text,
  slot_date date not null,     -- IST date the message belongs to (caps: 1 promo per buyer per day)
  status text not null default 'queued',  -- queued | sent | delivered | read | failed | dry_run
  provider_id text,            -- WhatsApp message id (wamid...)
  link_path text,              -- where /go/<id> sends the tap (UTMs added there)
  error text,
  clicked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists message_log_buyer_day on public.message_log (buyer_id, slot_date);
create index if not exists message_log_provider on public.message_log (provider_id);
alter table public.message_log enable row level security;  -- service role only

alter table public.buyers add column if not exists whatsapp_opt_in_at timestamptz;
alter table public.buyers add column if not exists whatsapp_opt_out_at timestamptz;
alter table public.sellers add column if not exists whatsapp_opt_in_at timestamptz;
alter table public.sellers add column if not exists whatsapp_opt_out_at timestamptz;
