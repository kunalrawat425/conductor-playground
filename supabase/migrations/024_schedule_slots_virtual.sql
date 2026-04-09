-- Make seller schedule slots virtual (generated), with overrides stored in config.
-- Keeps existing tables for backward compatibility, but new code should not materialize slots.

alter table seller_schedule_configs
  add column if not exists days_ahead int,
  add column if not exists disabled_dates jsonb not null default '[]'::jsonb,
  add column if not exists disabled_slots jsonb not null default '[]'::jsonb;

-- Backfill days_ahead from legacy date_from/date_to when possible.
update seller_schedule_configs
set days_ahead = greatest(
  1,
  least(60, (date_to - date_from) + 1)
)
where days_ahead is null;

