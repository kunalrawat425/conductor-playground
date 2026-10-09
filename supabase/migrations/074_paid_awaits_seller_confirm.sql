-- 074: payment makes an order PAID; the seller's accept makes it CONFIRMED.
--
-- Product rule (2026-10-09): a buyer paying must not look like the seller
-- accepted. Lifecycle: pending_payment → paid → (seller) confirmed →
-- ready_for_pickup / out_for_delivery → completed. From paid the seller can
-- also decline, and the buyer can cancel; both refund in full.
--
-- Stock is taken when the order becomes PAID (money is in), not when the
-- seller accepts — otherwise two paid orders could both wait on the last kg.
-- Same bookkeeping as 071 (record what was taken, give back exactly that);
-- pre-orders still never touch today's stock. Idempotent.

create or replace function public.decrement_listing_inventory_on_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_before numeric; v_take numeric;
begin
  if NEW.listing_id is not null
    and OLD.inventory_deducted is false
    and OLD.status in ('pre_order', 'pending_payment')
    and NEW.status in ('paid', 'confirmed')
    and not coalesce(NEW.is_preorder, false) then
    select weight_avail into v_before from fish_listings where id = NEW.listing_id for update;
    v_take := least(coalesce(v_before, 0), NEW.quantity);
    update fish_listings set weight_avail = coalesce(v_before, 0) - v_take where id = NEW.listing_id;
    update orders set inventory_deducted = true, inventory_deducted_qty = v_take where id = NEW.id;
    update fish_listings set is_available = false where id = NEW.listing_id and weight_avail <= 0;
  end if;
  return NEW;
end;
$$;
revoke execute on function public.decrement_listing_inventory_on_confirm() from public, anon, authenticated;

alter table public.orders drop constraint if exists orders_fulfilment_needs_payment;
alter table public.orders add constraint orders_fulfilment_needs_payment
  check (status not in ('paid', 'confirmed', 'ready_for_pickup', 'out_for_delivery', 'completed', 'picked_up')
         or razorpay_payment_id is not null or payment_verified_at is not null
         or payment_method is not distinct from 'cod_legacy');
