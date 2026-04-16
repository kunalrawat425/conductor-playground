-- 1. Atomic stock check: replace app-level check with DB function
create or replace function create_order_atomic(
  p_listing_id uuid,
  p_species text,
  p_quantity numeric,
  p_quantity_unit text,
  p_buyer_phone text,
  p_buyer_id uuid,
  p_buyer_addr text,
  p_total_price numeric,
  p_delivery_fee numeric,
  p_status text,
  p_order_type text,
  p_scheduled_for timestamptz,
  p_schedule_slot_id uuid
) returns uuid as $$
declare
  v_order_id uuid;
  v_avail numeric;
begin
  -- Lock the listing row and check stock atomically
  if p_listing_id is not null then
    select weight_avail into v_avail
    from fish_listings
    where id = p_listing_id
    for update;

    if v_avail is null then
      raise exception 'Listing not found';
    end if;

    if v_avail < p_quantity then
      raise exception 'Only % % in stock', v_avail, p_quantity_unit;
    end if;

    -- Decrement stock atomically
    update fish_listings
    set weight_avail = weight_avail - p_quantity
    where id = p_listing_id;
  end if;

  -- Insert order
  insert into orders (
    listing_id, species, quantity, quantity_unit, buyer_phone, buyer_id,
    buyer_addr, total_price, delivery_fee, platform_fee, status, order_type,
    payment_type, paid_amount, scheduled_for, schedule_slot_id
  ) values (
    p_listing_id, p_species, p_quantity, p_quantity_unit, p_buyer_phone, p_buyer_id,
    p_buyer_addr, p_total_price, p_delivery_fee, 0, p_status, p_order_type,
    'cod', case when p_status = 'pre_order' then p_total_price + p_delivery_fee else null end,
    p_scheduled_for, p_schedule_slot_id
  ) returning id into v_order_id;

  return v_order_id;
end;
$$ language plpgsql;

-- 1b. Restore stock on cancel
create or replace function restore_order_stock(p_listing_id uuid, p_quantity numeric)
returns void as $$
begin
  update fish_listings set weight_avail = weight_avail + p_quantity where id = p_listing_id;
end;
$$ language plpgsql;

-- 2. OTP rate limiting table
create table if not exists otp_attempts (
  phone text primary key,
  attempts int default 1,
  first_attempt timestamptz default now(),
  blocked_until timestamptz
);

-- 3. Low stock threshold on sellers
alter table sellers add column if not exists low_stock_threshold numeric default 2;
