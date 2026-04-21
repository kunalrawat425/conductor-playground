-- Pre-order price reconciliation.
-- Seller sets final_price after catch; system auto-compares to paid_amount.
-- Overpaid → refund. Match → confirm. Underpaid → payment_required.

alter table orders
  add column if not exists final_price numeric(10,2);

comment on column orders.final_price is 'Actual price set by seller after catch. Compared to paid_amount for reconciliation.';
comment on column orders.paid_amount is 'Amount buyer paid at pre-order time (listing.price × qty). Set at order creation.';

-- Reconciliation function: triggered when seller sets final_price on a pre_order.
-- Returns the new status so the API can notify both parties.
create or replace function reconcile_preorder_price(
  p_order_id uuid,
  p_final_price numeric
) returns text as $$
declare
  v_paid numeric;
  v_new_status text;
begin
  select paid_amount into v_paid from orders where id = p_order_id;
  if v_paid is null then
    raise exception 'Order % has no paid_amount — not a pre-order', p_order_id;
  end if;

  if p_final_price = v_paid then
    v_new_status := 'confirmed';
  elsif p_final_price < v_paid then
    v_new_status := 'refunded';   -- seller owes buyer the difference
  else
    v_new_status := 'payment_required'; -- buyer short-paid
  end if;

  update orders
    set final_price = p_final_price,
        status = v_new_status,
        updated_at = now()
  where id = p_order_id;

  return v_new_status;
end;
$$ language plpgsql security definer;

comment on function reconcile_preorder_price is
  'Sets final_price on a pre-order and returns new status: confirmed | refunded | payment_required. Call from /api/seller/orders action=set_final_price.';
