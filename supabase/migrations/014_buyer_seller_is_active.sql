-- Buyers: active by default (can be deactivated by admin / ops).
-- Sellers: existing rows stay active; new sign-ups default inactive until activated.

alter table buyers add column if not exists is_active boolean not null default true;

alter table sellers add column if not exists is_active boolean;
update sellers set is_active = true where is_active is null;
alter table sellers alter column is_active set not null;
alter table sellers alter column is_active set default false;
