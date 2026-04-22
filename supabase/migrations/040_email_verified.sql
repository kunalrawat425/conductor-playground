-- Email verification flag for buyers and sellers
alter table sellers add column if not exists email_verified boolean not null default false;
alter table buyers add column if not exists email_verified boolean not null default false;

-- Reset verified when email changes (trigger)
create or replace function reset_email_verified() returns trigger as $$
begin
  if OLD.email is distinct from NEW.email then
    NEW.email_verified = false;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_sellers_reset_email_verified on sellers;
create trigger trg_sellers_reset_email_verified
  before update on sellers for each row execute function reset_email_verified();

drop trigger if exists trg_buyers_reset_email_verified on buyers;
create trigger trg_buyers_reset_email_verified
  before update on buyers for each row execute function reset_email_verified();
