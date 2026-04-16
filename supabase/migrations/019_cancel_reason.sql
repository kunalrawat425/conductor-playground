-- Track who cancelled and why
alter table orders add column if not exists cancelled_by text; -- 'buyer' or 'seller'
alter table orders add column if not exists cancel_reason text;
