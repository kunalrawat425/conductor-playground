-- Multiple price tiers per listing: custom labels + piece/dozen unit for stock/orders
alter table fish_listings add column if not exists pricing_options jsonb;

-- Backfill from legacy price + price_unit
update fish_listings
set pricing_options = jsonb_build_array(
  jsonb_build_object(
    'id', 'default',
    'label', case price_unit
      when 'dozen' then 'Per dozen'
      when 'piece' then 'Per piece'
      else 'Per ' || price_unit::text
    end,
    'price', price,
    'unit', price_unit
  )
)
where pricing_options is null;

alter table orders add column if not exists pricing_option_id text;
alter table orders add column if not exists pricing_label text;

-- Extend atomic order insert to store chosen tier
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
  p_schedule_slot_id uuid,
  p_pricing_option_id text default null,
  p_pricing_label text default null
) returns uuid as $$
declare
  v_order_id uuid;
  v_avail numeric;
begin
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

    update fish_listings
    set weight_avail = weight_avail - p_quantity
    where id = p_listing_id;
  end if;

  insert into orders (
    listing_id, species, quantity, quantity_unit, buyer_phone, buyer_id,
    buyer_addr, total_price, delivery_fee, platform_fee, status, order_type,
    payment_type, paid_amount, scheduled_for, schedule_slot_id,
    pricing_option_id, pricing_label
  ) values (
    p_listing_id, p_species, p_quantity, p_quantity_unit, p_buyer_phone, p_buyer_id,
    p_buyer_addr, p_total_price, p_delivery_fee, 0, p_status, p_order_type,
    'cod', case when p_status = 'pre_order' then p_total_price + p_delivery_fee else null end,
    p_scheduled_for, p_schedule_slot_id,
    p_pricing_option_id, p_pricing_label
  ) returning id into v_order_id;

  return v_order_id;
end;
$$ language plpgsql;
