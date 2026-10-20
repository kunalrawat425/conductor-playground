-- The seller's final price is the FISH price. paid_amount includes the delivery
-- fee, so comparing the two refunded the fee on every cheaper catch (paid ₹613 =
-- ₹600 + ₹13 fee, final ₹550 → refunded ₹63 instead of ₹50) and under-charged a
-- dearer one by the fee. Compare against what was paid for the fish.
create or replace function public.reconcile_preorder_price(
  p_order_id uuid,
  p_final_price numeric
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid numeric;
  v_new_status text;
  v_refund_due numeric := 0;
begin
  -- Row lock + "not set yet": a double-submitted final price used to reconcile
  -- (and refund the difference) twice.
  select paid_amount - coalesce(delivery_fee, 0) into v_paid from orders
    where id = p_order_id and final_price is null for update;
  if not found then
    raise exception 'Final price already set for order %', p_order_id;
  end if;
  if v_paid is null then
    raise exception 'Order % has no paid_amount — not a pre-order', p_order_id;
  end if;

  if p_final_price > v_paid then
    v_new_status := 'payment_required';   -- buyer short-paid, owes the balance
  else
    -- Equal, or cheaper than estimated: confirmed, and we owe the difference.
    v_new_status := 'confirmed';
    v_refund_due := greatest(v_paid - p_final_price, 0);
  end if;

  update orders
    set final_price = p_final_price,
        status = v_new_status,
        refund_amt = case when v_refund_due > 0 then v_refund_due else refund_amt end
  where id = p_order_id;

  return v_new_status;
end;
$$;

revoke execute on function public.reconcile_preorder_price(uuid, numeric) from public, anon, authenticated;
