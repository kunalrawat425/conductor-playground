-- BUG-43: a pre-order whose final price came in LOWER than the buyer already
-- paid was marked status = 'refunded'. That status is terminal as far as the
-- inventory trigger is concerned, so trg_restore_inventory returned the stock
-- and set inventory_deducted = false / is_available = true — while the order
-- itself carried on being fulfilled (seller/orders.ts explicitly allows
-- refunded -> ready_for_pickup | out_for_delivery, and the dashboard renders
-- those buttons). The seller got the fish back into sellable inventory AND
-- handed it to the buyer, so the next sale had no stock behind it and nothing
-- ever re-deducted.
--
-- This is common, not an edge case: paid_amount is pre-set to the estimate at
-- creation, so any catch that came in cheaper than estimated hits this path.
--
-- Fix: stop overloading 'refunded'. The order IS confirmed — there is simply a
-- difference owed back to the buyer. Record that in refund_amt (already used
-- with exactly this meaning by orders/cancel.ts and the Razorpay webhook) and
-- leave the status as 'confirmed' so the order stays live and its stock stays
-- deducted. 'refunded' now means only what it says: money went back and the
-- order is over.

create or replace function reconcile_preorder_price(
  p_order_id uuid,
  p_final_price numeric
) returns text as $$
declare
  v_paid numeric;
  v_new_status text;
  v_refund_due numeric := 0;
begin
  select paid_amount into v_paid from orders where id = p_order_id;
  if v_paid is null then
    raise exception 'Order % has no paid_amount — not a pre-order', p_order_id;
  end if;

  if p_final_price > v_paid then
    v_new_status := 'payment_required';   -- buyer short-paid, owes the balance
  else
    -- Equal, or cheaper than estimated. Either way the order is confirmed;
    -- a cheaper catch just means we owe the buyer the difference.
    v_new_status := 'confirmed';
    v_refund_due := greatest(v_paid - p_final_price, 0);
  end if;

  -- BUG-48: the original function (migration 043) also set `updated_at = now()`,
  -- but orders has no such column on either staging or production. Every call
  -- therefore raised 42703 and the endpoint returned 500 — "Set final price"
  -- has been broken for pre-orders since it shipped. Column dropped from the
  -- UPDATE; nothing else writes orders.updated_at.
  update orders
    set final_price = p_final_price,
        status = v_new_status,
        refund_amt = case when v_refund_due > 0 then v_refund_due else refund_amt end
  where id = p_order_id;

  return v_new_status;
end;
$$ language plpgsql security definer;

comment on function reconcile_preorder_price is
  'Sets final_price on a pre-order. Returns confirmed | payment_required. A price below paid_amount stays confirmed and records the difference in refund_amt — it must NOT use status refunded, which would trip trg_restore_inventory on an order that is still being fulfilled (BUG-43).';
