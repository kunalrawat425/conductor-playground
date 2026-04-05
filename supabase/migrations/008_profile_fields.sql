-- Add first_name, last_name, email to sellers and buyers

alter table sellers
  add column if not exists first_name text default '',
  add column if not exists last_name text default '',
  add column if not exists email text default '';

alter table buyers
  add column if not exists first_name text default '',
  add column if not exists last_name text default '',
  add column if not exists email text default '';
