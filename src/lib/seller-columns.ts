/**
 * Seller columns the public key may read (migration 085). Phone, email, UPI, push and login
 * ids stay server-only; the seller's own dashboard gets them from GET /api/seller/profile.
 * A new sellers column must be added here AND granted in a migration, or public reads fail.
 */
export const SELLER_PUBLIC_COLUMNS =
  "id, name, location, location_name, lat, lng, rating_avg, rating_count, total_orders, created_at, is_active, is_test, " +
  "has_delivery, has_pickup, delivery_rad, min_order_amount, low_stock_threshold, push_enabled, email_verified, " +
  "delivery_fee_enabled, delivery_fee_amount, delivery_fee_type, delivery_fee_per_km, free_delivery_above, " +
  "opens_at, closes_at, open_days, accepts_preorder, preorder_days, preorder_cutoff_time, preorder_opens_at, delivery_days, " +
  "schedule_pickup_slots, delivery_slots_enabled, delivery_slot_minutes, preorder_delivery_start, preorder_delivery_end, " +
  "preorder_days_ahead, store_image_url, logo_url";
