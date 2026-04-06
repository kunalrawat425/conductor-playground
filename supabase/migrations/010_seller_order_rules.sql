-- Seller minimum order, delivery fee, free-delivery threshold

alter table sellers add column if not exists min_order_amount numeric(10, 2) not null default 0;
alter table sellers add column if not exists delivery_fee_enabled boolean not null default false;
alter table sellers add column if not exists delivery_fee_amount numeric(10, 2) not null default 0;
alter table sellers add column if not exists free_delivery_above numeric(10, 2);

comment on column sellers.min_order_amount is 'Minimum item subtotal (₹) per order line; 0 = no minimum';
comment on column sellers.delivery_fee_enabled is 'When true, charge delivery_fee_amount on delivery orders unless free_delivery_above met';
comment on column sellers.free_delivery_above is 'Waive delivery fee when subtotal >= this amount (₹); null = no waiver';

alter table orders add column if not exists delivery_fee numeric(10, 2) not null default 0;
