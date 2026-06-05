-- Drop the create_order_atomic overload that references checkout_session_id
-- (column does not exist in orders table — causes ambiguous function error)
DROP FUNCTION IF EXISTS public.create_order_atomic(
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
  p_scheduled_for timestamp with time zone,
  p_schedule_slot_id uuid,
  p_pricing_option_id text,
  p_pricing_label text,
  p_checkout_session_id uuid
);
