-- Add p_checkout_session_id param to create_order_atomic.
-- Default null = backwards compatible with any existing callers.
create or replace function public.create_order_atomic(
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
  p_pricing_label text default null,
  p_checkout_session_id uuid default null
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

    if p_status is distinct from 'pending_payment' and p_status is distinct from 'pre_order' then
      update fish_listings
      set weight_avail = weight_avail - p_quantity
      where id = p_listing_id;
    end if;
  end if;

  insert into orders (
    listing_id, species, quantity, quantity_unit, buyer_phone, buyer_id,
    buyer_addr, total_price, delivery_fee, platform_fee, status, order_type,
    payment_type, paid_amount, scheduled_for, schedule_slot_id,
    pricing_option_id, pricing_label, checkout_session_id
  ) values (
    p_listing_id, p_species, p_quantity, p_quantity_unit, p_buyer_phone, p_buyer_id,
    p_buyer_addr, p_total_price, p_delivery_fee, 0, p_status, p_order_type,
    'cod',
    case when p_status in ('pre_order', 'pending_payment')
         then p_total_price + p_delivery_fee else null end,
    p_scheduled_for, p_schedule_slot_id,
    p_pricing_option_id, p_pricing_label,
    p_checkout_session_id
  ) returning id into v_order_id;

  return v_order_id;
end;
$$ language plpgsql;
